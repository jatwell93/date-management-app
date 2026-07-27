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
 * Usage:
 *   doppler run -- node scripts/run-authenticated-smoke.js
 *
 * Environment variables (injected by `doppler run` against production config):
 *   CLERK_SECRET_KEY     — production Clerk secret key (powerful credential;
 *                          blast radius controlled by the protected GitHub
 *                          `production` environment + reviewed main branch)
 *   SMOKE_USER_ID        — Clerk user ID of the dedicated smoke-test identity
 *   SMOKE_TARGET_URL     — base URL of the deployed Worker (required)
 *   SMOKE_ENDPOINTS      — optional comma-separated list of paths
 *   SMOKE_LATENCY_MS     — optional per-endpoint latency budget in ms
 *   SMOKE_TIMEOUT_MS     — optional per-request timeout in ms
 *   CLERK_API_TIMEOUT_MS — optional timeout for Clerk API calls (default 10000)
 *
 * Exit codes:
 *   0 — smoke probes passed AND session was revoked
 *   1 — probe failure, mint failure, createSession failure, or revocation failure
 *
 * Output: a JSON evidence document on stdout (sanitized — never contains the
 * JWT or Clerk secret key). Errors and warnings go to stderr.
 */
const { main: smokeMain } = require('./post-deploy-smoke.js');

const CLERK_API_BASE = 'https://api.clerk.com/v1';
const DEFAULT_CLERK_TIMEOUT_MS = 10_000;

/**
 * Create an active Clerk session for a user.
 * @param {typeof fetch} clerkFetch
 * @param {{ secretKey: string; userId: string; timeoutMs?: number }} opts
 * @returns {Promise<{ sessionId: string; userId: string }>}
 */
async function createSession(clerkFetch, opts) {
  const timeoutMs = opts.timeoutMs || DEFAULT_CLERK_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await clerkFetch(`${CLERK_API_BASE}/sessions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${opts.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: opts.userId }),
    });
    if (!response.ok) {
      const status = response.status;
      let detail = '';
      try {
        detail = JSON.stringify(await response.json());
      } catch {
        // non-JSON body — ignore
      }
      throw new Error(`createSession failed: HTTP ${status}${detail ? ` ${detail}` : ''}`);
    }
    const body = await response.json();
    if (body.user_id !== opts.userId) {
      throw new Error(
        `createSession: session user_id mismatch — expected ${opts.userId}, got ${body.user_id}`,
      );
    }
    return { sessionId: body.id, userId: body.user_id };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(
        `createSession timed out after ${timeoutMs}ms; Clerk may have created the session before the response was received`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mint a session token (JWT) from an active session.
 * @param {typeof fetch} clerkFetch
 * @param {{ secretKey: string; sessionId: string; timeoutMs?: number }} opts
 * @returns {Promise<{ token: string }>}
 */
async function mintSessionToken(clerkFetch, opts) {
  const timeoutMs = opts.timeoutMs || DEFAULT_CLERK_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await clerkFetch(`${CLERK_API_BASE}/sessions/${opts.sessionId}/tokens`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${opts.secretKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const status = response.status;
      let detail = '';
      try {
        detail = JSON.stringify(await response.json());
      } catch {
        // non-JSON body — ignore
      }
      throw new Error(`mintSessionToken failed: HTTP ${status}${detail ? ` ${detail}` : ''}`);
    }
    const body = await response.json();
    if (!body.jwt) {
      throw new Error('mintSessionToken: response missing jwt field');
    }
    return { token: body.jwt };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Revoke a Clerk session. Returns { revoked: true } on success, { revoked: false }
 * on failure — does not throw, so it can be used in a finally block without
 * masking an earlier error.
 * @param {typeof fetch} clerkFetch
 * @param {{ secretKey: string; sessionId: string; timeoutMs?: number }} opts
 * @returns {Promise<{ revoked: boolean; error?: string }>}
 */
async function revokeSession(clerkFetch, opts) {
  const timeoutMs = opts.timeoutMs || DEFAULT_CLERK_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await clerkFetch(`${CLERK_API_BASE}/sessions/${opts.sessionId}/revoke`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${opts.secretKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const status = response.status;
      let detail = '';
      try {
        detail = JSON.stringify(await response.json());
      } catch {
        // non-JSON body — ignore
      }
      return {
        revoked: false,
        error: `revokeSession failed: HTTP ${status}${detail ? ` ${detail}` : ''}`,
      };
    }
    return { revoked: true };
  } catch (error) {
    return {
      revoked: false,
      error: `revokeSession failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Orchestrate the authenticated smoke test: create session → mint token →
 * run smoke probes → revoke session. The JWT and Clerk secret are never
 * written to stdout or stderr.
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
  const clerkTimeoutMs = Number(env.CLERK_API_TIMEOUT_MS || DEFAULT_CLERK_TIMEOUT_MS);

  let session = null;
  let smokeExitCode = null;
  let smokeError = null;
  let smokeEvidence = undefined;
  let smokeStderr = '';
  let revocationResult = { revoked: false };
  let orchestrationError = null;

  try {
    // 1. Create a fresh session for the smoke identity
    session = await createSession(clerkFetch, { secretKey, userId, timeoutMs: clerkTimeoutMs });

    // 2. Mint a short-lived JWT from that session
    const { token } = await mintSessionToken(clerkFetch, {
      secretKey,
      sessionId: session.sessionId,
      timeoutMs: clerkTimeoutMs,
    });

    // 3. Run the existing smoke probes in-process with the JWT as auth.
    //    Capture smoke stdout/stderr into buffers so the wrapper's own
    //    evidence document is the only thing on the real stdout.
    const smokeOutChunks = [];
    const smokeErrChunks = [];
    const smokeEnv = { ...env, SMOKE_AUTH_TOKEN: token };
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
  createSession,
  mintSessionToken,
  revokeSession,
  runAuthenticatedSmoke,
  CLERK_API_BASE,
  DEFAULT_CLERK_TIMEOUT_MS,
};

if (require.main === module) {
  void runAuthenticatedSmoke(process.env).then((code) => {
    process.exitCode = code;
  });
}
