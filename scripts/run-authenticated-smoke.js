#!/usr/bin/env node
/**
 * Phase 1 task 1.7.B — authenticated canary smoke test orchestrator.
 *
 * Mints a short-lived Clerk session token for a dedicated smoke-test identity,
 * invokes the existing post-deploy-smoke.js logic in-process with that token,
 * and revokes the session in a finally block. Designed to be run twice by the
 * canary job in workers-deploy.yml (round 1 immediately, round 2 after the
 * wait window) — each round gets a fresh session, never carrying a JWT across
 * the 15-minute canary window.
 *
 * Production session minting: the Backend API `POST /sessions` endpoint is
 * DEV-ONLY (it returns HTTP 400 `request_invalid_for_environment` on a
 * production `sk_live_` instance). So on production we mint via the supported
 * two-step flow:
 *   1. `POST /sign_in_tokens` (Backend API) — create a single-use sign-in token
 *      for the smoke user.
 *   2. Redeem the token as a `ticket` against the Frontend API
 *      (`POST https://<fapi-host>/v1/client/sign_ins`), which completes the
 *      sign-in and returns a real session + session token (JWT). The Frontend
 *      API host is derived from `CLERK_PUBLISHABLE_KEY`; the request `Origin`
 *      (which becomes the token's `azp`) must match `FRONTEND_URL` so the
 *      Worker's `authorizedParties` check accepts the token.
 * The session is revoked via the Backend API `POST /sessions/{id}/revoke`.
 *
 * Usage:
 *   doppler run -- node scripts/run-authenticated-smoke.js
 *
 * Environment variables (injected by `doppler run` against production config):
 *   CLERK_SECRET_KEY      — production Clerk secret key (powerful credential;
 *                           blast radius controlled by the protected GitHub
 *                           `production` environment + reviewed main branch)
 *   CLERK_PUBLISHABLE_KEY — production Clerk publishable key; the Frontend API
 *                           host is derived from it. `CLERK_FAPI_HOST` overrides.
 *   FRONTEND_URL          — production frontend origin; used as the FAPI request
 *                           `Origin` so the minted token's `azp` is authorized.
 *                           `SMOKE_ORIGIN` overrides.
 *   SMOKE_USER_ID         — Clerk user ID of the dedicated smoke-test identity
 *   SMOKE_ORG_ID          — optional Clerk org ID to scope the session to
 *   SMOKE_TARGET_URL      — base URL of the deployed Worker (required)
 *   SMOKE_ENDPOINTS       — optional comma-separated list of paths
 *   SMOKE_LATENCY_MS      — optional per-endpoint latency budget in ms
 *   SMOKE_TIMEOUT_MS      — optional per-request timeout in ms
 *   CLERK_API_TIMEOUT_MS  — optional timeout for Clerk API calls (default 10000)
 *   CLERK_JS_VERSION      — optional _clerk_js_version query value (default 5.0.0)
 *
 * Exit codes:
 *   0 — smoke probes passed AND session was revoked
 *   1 — probe failure, mint failure, redeem failure, or revocation failure
 *
 * Output: a JSON evidence document on stdout (sanitized — never contains the
 * JWT, sign-in token, or Clerk secret key). Errors and warnings go to stderr.
 */
const { main: smokeMain } = require('./post-deploy-smoke.js');

const CLERK_API_BASE = 'https://api.clerk.com/v1';
const DEFAULT_CLERK_TIMEOUT_MS = 10_000;
const DEFAULT_CLERK_JS_VERSION = '5.0.0';

/**
 * Derive the Frontend API host from a Clerk publishable key. Publishable keys
 * are `pk_(live|test)_<base64(fapiHost + "$")>`; decoding yields the FAPI host
 * with a trailing `$` marker that we strip.
 * @param {string | undefined} publishableKey
 * @returns {string | null}
 */
function deriveFapiHost(publishableKey) {
  if (!publishableKey) return null;
  const b64 = publishableKey.replace(/^pk_(?:live|test)_/, '');
  try {
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    const host = decoded.replace(/\$+$/, '').trim();
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Run a fetch with an abort-based timeout. Returns the Response.
 * @param {typeof fetch} fetchImpl
 * @param {string} label — used in the timeout error message
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(fetchImpl, label, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorDetail(response) {
  try {
    const body = await response.json();
    // Surface only Clerk's structured error code + message — never the whole
    // response body. Frontend API bodies can carry client/session objects or
    // token fragments, and this detail is embedded in error messages that flow
    // into the evidence document on stdout; serializing the full body would
    // break this script's guarantee that its output never contains the JWT,
    // sign-in token, or secret key.
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      return JSON.stringify(body.errors.map((e) => ({ code: e.code, message: e.message })));
    }
    if (body.status) {
      return JSON.stringify({ status: body.status });
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Create a single-use sign-in token for a user (Backend API). Optionally scoped
 * to an organization, which Clerk activates for the resulting session.
 * @param {typeof fetch} clerkFetch
 * @param {{ secretKey: string; userId: string; orgId?: string; timeoutMs?: number }} opts
 * @returns {Promise<{ token: string }>}
 */
async function createSignInToken(clerkFetch, opts) {
  const timeoutMs = opts.timeoutMs || DEFAULT_CLERK_TIMEOUT_MS;
  const response = await fetchWithTimeout(
    clerkFetch,
    'createSignInToken',
    `${CLERK_API_BASE}/sign_in_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: opts.userId,
        ...(opts.orgId ? { org_id: opts.orgId } : {}),
      }),
    },
    timeoutMs,
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(
      `createSignInToken failed: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
    );
  }
  const body = await response.json();
  if (!body.token) {
    throw new Error('createSignInToken: response missing token field');
  }
  return { token: body.token };
}

/**
 * Redeem a sign-in token as a `ticket` against the Frontend API, completing the
 * sign-in and returning the created session id plus its session token (JWT).
 *
 * The session token is read from the `client.sessions[].last_active_token.jwt`
 * field of the sign_ins response (populated when the sign-in completes). If a
 * session was created but no token is present — or the sign-in did not reach
 * `complete` status — `jwt` is `null` (with the session id still returned) so
 * the caller can revoke the session instead of orphaning it.
 * @param {typeof fetch} clerkFetch
 * @param {{ fapiHost: string; origin: string; ticket: string; timeoutMs?: number; jsVersion?: string }} opts
 * @returns {Promise<{ sessionId: string; jwt: string | null }>}
 */
async function redeemTicket(clerkFetch, opts) {
  const timeoutMs = opts.timeoutMs || DEFAULT_CLERK_TIMEOUT_MS;
  const jsVersion = opts.jsVersion || DEFAULT_CLERK_JS_VERSION;
  const url = `https://${opts.fapiHost}/v1/client/sign_ins?_clerk_js_version=${encodeURIComponent(jsVersion)}`;
  const response = await fetchWithTimeout(
    clerkFetch,
    'redeemTicket',
    url,
    {
      method: 'POST',
      headers: {
        Origin: opts.origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ strategy: 'ticket', ticket: opts.ticket }).toString(),
    },
    timeoutMs,
  );
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new Error(`redeemTicket failed: HTTP ${response.status}${detail ? ` ${detail}` : ''}`);
  }
  const body = await response.json();
  const signIn = body.response || body;
  // Resolve the session id BEFORE the completeness check. Clerk may have
  // created a session server-side even when the sign-in response is not
  // `complete`; if we threw here without surfacing that id, the orchestrator's
  // `session` would stay null and the finally-block revocation would be
  // skipped, orphaning an un-revokable session until it expires naturally.
  const sessionId =
    signIn.created_session_id || (body.client && body.client.last_active_session_id) || null;
  if (signIn.status !== 'complete') {
    // Hand back any created session with a null JWT so the caller can still
    // revoke it. The missing JWT makes the orchestration fail (the correct
    // outcome for an incomplete sign-in) while guaranteeing cleanup.
    if (sessionId) {
      return { sessionId, jwt: null };
    }
    throw new Error(`redeemTicket: sign-in not complete (status=${signIn.status ?? 'unknown'})`);
  }
  if (!sessionId) {
    throw new Error('redeemTicket: sign-in complete but no created_session_id');
  }
  const sessions = (body.client && body.client.sessions) || [];
  const session = Array.isArray(sessions) ? sessions.find((s) => s.id === sessionId) : null;
  const jwt = (session && session.last_active_token && session.last_active_token.jwt) || null;
  return { sessionId, jwt };
}

/**
 * Revoke a Clerk session (Backend API). Returns { revoked: true } on success,
 * { revoked: false } on failure — does not throw, so it can be used in a
 * finally block without masking an earlier error.
 * @param {typeof fetch} clerkFetch
 * @param {{ secretKey: string; sessionId: string; timeoutMs?: number }} opts
 * @returns {Promise<{ revoked: boolean; error?: string }>}
 */
async function revokeSession(clerkFetch, opts) {
  const timeoutMs = opts.timeoutMs || DEFAULT_CLERK_TIMEOUT_MS;
  try {
    const response = await fetchWithTimeout(
      clerkFetch,
      'revokeSession',
      `${CLERK_API_BASE}/sessions/${opts.sessionId}/revoke`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.secretKey}`,
          'Content-Type': 'application/json',
        },
      },
      timeoutMs,
    );
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      return {
        revoked: false,
        error: `revokeSession failed: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
      };
    }
    return { revoked: true };
  } catch (error) {
    return {
      revoked: false,
      error: `revokeSession failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Orchestrate the authenticated smoke test: create sign-in token → redeem
 * ticket for a session JWT → run smoke probes → revoke session. The JWT,
 * sign-in token, and Clerk secret are never written to stdout or stderr.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ clerkFetch?: typeof fetch; smokeMain?: typeof smokeMain; stdout?: { write: (s: string) => void }; stderr?: { write: (s: string) => void } }} [deps]
 * @returns {Promise<number>} exit code (0 = pass, 1 = any failure)
 */
async function runAuthenticatedSmoke(env, deps) {
  const clerkFetch = deps?.clerkFetch || fetch;
  const smoke = deps?.smokeMain || smokeMain;
  const stdout = deps?.stdout || process.stdout;
  const stderr = deps?.stderr || process.stderr;

  const secretKey = env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error('CLERK_SECRET_KEY is required');
  const userId = env.SMOKE_USER_ID;
  if (!userId) throw new Error('SMOKE_USER_ID is required');
  const fapiHost = env.CLERK_FAPI_HOST || deriveFapiHost(env.CLERK_PUBLISHABLE_KEY);
  if (!fapiHost) {
    throw new Error(
      'CLERK_PUBLISHABLE_KEY (or CLERK_FAPI_HOST) is required to derive the Frontend API host',
    );
  }
  const origin = env.SMOKE_ORIGIN || env.FRONTEND_URL;
  if (!origin) {
    throw new Error('FRONTEND_URL (or SMOKE_ORIGIN) is required for the session token azp');
  }
  const orgId = env.SMOKE_ORG_ID;
  const clerkTimeoutMs = Number(env.CLERK_API_TIMEOUT_MS || DEFAULT_CLERK_TIMEOUT_MS);
  const jsVersion = env.CLERK_JS_VERSION || DEFAULT_CLERK_JS_VERSION;

  let session = null;
  let smokeExitCode = null;
  let smokeError = null;
  let smokeEvidence = undefined;
  let smokeStderr = '';
  let revocationResult = { revoked: false };
  let orchestrationError = null;

  try {
    // 1. Create a single-use sign-in token for the smoke identity (Backend API).
    const { token } = await createSignInToken(clerkFetch, {
      secretKey,
      userId,
      orgId,
      timeoutMs: clerkTimeoutMs,
    });

    // 2. Redeem it as a ticket against the Frontend API to complete sign-in
    //    and obtain a session + session token. Capture the session id as soon
    //    as it exists so the finally block can revoke it even if the token is
    //    missing from the response.
    const redeemed = await redeemTicket(clerkFetch, {
      fapiHost,
      origin,
      ticket: token,
      timeoutMs: clerkTimeoutMs,
      jsVersion,
    });
    session = { sessionId: redeemed.sessionId };
    if (!redeemed.jwt) {
      throw new Error('redeemTicket: session created but no session token returned');
    }
    const jwt = redeemed.jwt;

    // 3. Run the existing smoke probes in-process with the JWT as auth.
    //    Capture smoke stdout/stderr into buffers so the wrapper's own
    //    evidence document is the only thing on the real stdout.
    const smokeOutChunks = [];
    const smokeErrChunks = [];
    const smokeEnv = { ...env, SMOKE_AUTH_TOKEN: jwt };
    try {
      smokeExitCode = await smoke(smokeEnv, {
        fetch,
        stdout: { write: (s) => smokeOutChunks.push(s) },
        stderr: { write: (s) => smokeErrChunks.push(s) },
      });
    } catch (error) {
      smokeError = error instanceof Error ? error.message : String(error);
      smokeExitCode = 1;
    }
    smokeStderr = smokeErrChunks.join('');
    const smokeOut = smokeOutChunks.join('');
    if (smokeOut) {
      try {
        smokeEvidence = JSON.parse(smokeOut);
      } catch {
        smokeEvidence = undefined;
      }
    }
    // Forward smoke stderr to the real stderr so CI logs show probe failures.
    if (smokeStderr) stderr.write(smokeStderr);
  } catch (error) {
    orchestrationError = error instanceof Error ? error.message : String(error);
  } finally {
    // 4. Always revoke the session if one was created
    if (session) {
      revocationResult = await revokeSession(clerkFetch, {
        secretKey,
        sessionId: session.sessionId,
        timeoutMs: clerkTimeoutMs,
      });
      if (!revocationResult.revoked) {
        stderr.write(
          `::warning::Session revocation failed for session ${session.sessionId}: ` +
            `${revocationResult.error || 'unknown error'}\n`,
        );
      }
    }
  }

  // 5. Emit sanitized evidence (no JWT, no secret) — the only JSON on stdout
  const evidence = {
    checkedAt: new Date().toISOString(),
    smokeUserId: userId,
    session: session
      ? {
          sessionId: session.sessionId,
          revoked: revocationResult.revoked,
          revocationError: revocationResult.revoked ? undefined : revocationResult.error,
        }
      : { sessionId: null, revoked: false, revocationError: 'session was never created' },
    smokeExitCode,
    smokeError,
    smokeEvidence,
    orchestrationError,
  };
  stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);

  // 6. Exit non-zero if anything failed: orchestration error, probe failure,
  //    or revocation failure. Probe failure is the primary signal; revocation
  //    failure is a security signal that also fails the canary.
  if (orchestrationError) return 1;
  if (smokeExitCode !== 0) return 1;
  if (!revocationResult.revoked) return 1;
  return 0;
}

module.exports = {
  deriveFapiHost,
  createSignInToken,
  redeemTicket,
  revokeSession,
  runAuthenticatedSmoke,
  CLERK_API_BASE,
  DEFAULT_CLERK_TIMEOUT_MS,
  DEFAULT_CLERK_JS_VERSION,
};

if (require.main === module) {
  void runAuthenticatedSmoke(process.env).then((code) => {
    process.exitCode = code;
  });
}
