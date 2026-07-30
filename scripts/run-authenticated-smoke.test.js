const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveFapiHost,
  createSignInToken,
  redeemTicket,
  revokeSession,
  runAuthenticatedSmoke,
} = require('./run-authenticated-smoke.js');

const FAPI_HOST = 'clerk.example.test';
const SECRET = 'sk_test_secret_value_never_print';
const USER_ID = 'user_smoke_test_123';
const ORG_ID = 'org_smoke_test_123';
const SESSION_ID = 'ses_abc456';
const JWT = 'eyJ.eyJ.eyJ_fake_jwt_never_print';
const SIGN_IN_TOKEN = 'sit_fake_ticket_never_print';

/**
 * Build a fake fetch that responds to the Backend API (sign_in_tokens, revoke)
 * and Frontend API (client/sign_ins) endpoints in the canary lifecycle. Each
 * response map is keyed by `${method} ${pathname}` so Backend and Frontend API
 * calls (different hosts) are addressed by their path.
 */
function makeClerkFetch(responses = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const parsed = new URL(url);
    const path = parsed.pathname;
    calls.push({ url, method, path, host: parsed.host, body: opts.body, headers: opts.headers });
    const key = `${method} ${path}`;
    const entry = responses[key];
    if (!entry) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'not mocked' }),
        text: async () => JSON.stringify({ error: 'not mocked' }),
      };
    }
    if (entry instanceof Error) throw entry;
    return {
      ok: entry.status >= 200 && entry.status < 300,
      status: entry.status,
      json: async () => entry.body,
      text: async () => JSON.stringify(entry.body),
    };
  };
  fn.calls = calls;
  return fn;
}

/**
 * A fake smokeMain that records what it was called with and returns a
 * configurable exit code. Replaces the real post-deploy-smoke main() so
 * tests never hit the network.
 */
function makeSmokeMain(probeExitCode = 0) {
  const calls = [];
  const fn = async (env, deps) => {
    calls.push({ env: { ...env }, depsPresent: !!deps });
    deps.stdout.write(
      JSON.stringify({
        summary: {
          total: 2,
          passed: probeExitCode === 0 ? 2 : 0,
          failed: probeExitCode === 0 ? 0 : 2,
        },
        authenticated: !!env.SMOKE_AUTH_TOKEN,
      }) + '\n',
    );
    deps.stderr.write(probeExitCode === 0 ? '' : '::error::probe failed\n');
    return probeExitCode;
  };
  fn.calls = calls;
  return fn;
}

function makeIO() {
  const outChunks = [];
  const errChunks = [];
  return {
    stdout: { write: (s) => outChunks.push(s) },
    stderr: { write: (s) => errChunks.push(s) },
    outChunks,
    errChunks,
  };
}

const SIGN_INS_COMPLETE = {
  status: 200,
  body: {
    response: { status: 'complete', created_session_id: SESSION_ID },
    client: { sessions: [{ id: SESSION_ID, last_active_token: { jwt: JWT } }] },
  },
};

const DEFAULT_CLERK_RESPONSES = {
  'POST /v1/sign_in_tokens': {
    status: 200,
    body: { object: 'sign_in_token', token: SIGN_IN_TOKEN },
  },
  'POST /v1/client/sign_ins': SIGN_INS_COMPLETE,
  [`POST /v1/sessions/${SESSION_ID}/revoke`]: {
    status: 200,
    body: { id: SESSION_ID, status: 'revoked' },
  },
};

const BASE_ENV = {
  CLERK_SECRET_KEY: SECRET,
  SMOKE_USER_ID: USER_ID,
  SMOKE_TARGET_URL: 'https://api.example.com',
  CLERK_FAPI_HOST: FAPI_HOST,
  FRONTEND_URL: 'https://app.example.test',
};

// ── deriveFapiHost ──────────────────────────────────────────────────────

test('deriveFapiHost: decodes the FAPI host from a publishable key', () => {
  const pk = 'pk_live_' + Buffer.from(`${FAPI_HOST}$`).toString('base64');
  assert.equal(deriveFapiHost(pk), FAPI_HOST);
});

test('deriveFapiHost: returns null for empty input', () => {
  assert.equal(deriveFapiHost(undefined), null);
  assert.equal(deriveFapiHost(''), null);
});

// ── createSignInToken ───────────────────────────────────────────────────

test('createSignInToken: POSTs /sign_in_tokens with Bearer secret and user_id', async () => {
  const clerkFetch = makeClerkFetch(DEFAULT_CLERK_RESPONSES);
  const result = await createSignInToken(clerkFetch, {
    secretKey: SECRET,
    userId: USER_ID,
    timeoutMs: 5000,
  });
  assert.equal(result.token, SIGN_IN_TOKEN);
  assert.equal(clerkFetch.calls.length, 1);
  assert.equal(clerkFetch.calls[0].method, 'POST');
  assert.equal(clerkFetch.calls[0].path, '/v1/sign_in_tokens');
  const body = JSON.parse(clerkFetch.calls[0].body);
  assert.equal(body.user_id, USER_ID);
  assert.equal(body.org_id, undefined);
});

test('createSignInToken: includes org_id when provided', async () => {
  const clerkFetch = makeClerkFetch(DEFAULT_CLERK_RESPONSES);
  await createSignInToken(clerkFetch, {
    secretKey: SECRET,
    userId: USER_ID,
    orgId: ORG_ID,
    timeoutMs: 5000,
  });
  const body = JSON.parse(clerkFetch.calls[0].body);
  assert.equal(body.org_id, ORG_ID);
});

test('createSignInToken: throws on non-2xx response', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /v1/sign_in_tokens': { status: 422, body: { error: 'bad user' } },
  });
  await assert.rejects(
    createSignInToken(clerkFetch, { secretKey: SECRET, userId: USER_ID, timeoutMs: 5000 }),
    /createSignInToken failed.*422/,
  );
});

test('createSignInToken: throws when token missing from response', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /v1/sign_in_tokens': { status: 200, body: { object: 'sign_in_token' } },
  });
  await assert.rejects(
    createSignInToken(clerkFetch, { secretKey: SECRET, userId: USER_ID, timeoutMs: 5000 }),
    /missing token field/,
  );
});

// ── redeemTicket ────────────────────────────────────────────────────────

test('redeemTicket: POSTs FAPI /client/sign_ins with ticket strategy and returns sessionId + jwt', async () => {
  const clerkFetch = makeClerkFetch(DEFAULT_CLERK_RESPONSES);
  const result = await redeemTicket(clerkFetch, {
    fapiHost: FAPI_HOST,
    origin: 'https://app.example.test',
    ticket: SIGN_IN_TOKEN,
    timeoutMs: 5000,
  });
  assert.equal(result.sessionId, SESSION_ID);
  assert.equal(result.jwt, JWT);
  const call = clerkFetch.calls[0];
  assert.equal(call.host, FAPI_HOST);
  assert.equal(call.path, '/v1/client/sign_ins');
  assert.equal(call.headers.Origin, 'https://app.example.test');
  const params = new URLSearchParams(call.body);
  assert.equal(params.get('strategy'), 'ticket');
  assert.equal(params.get('ticket'), SIGN_IN_TOKEN);
});

test('redeemTicket: throws on non-2xx response', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /v1/client/sign_ins': { status: 401, body: { error: 'bad ticket' } },
  });
  await assert.rejects(
    redeemTicket(clerkFetch, {
      fapiHost: FAPI_HOST,
      origin: 'https://x',
      ticket: 'y',
      timeoutMs: 5000,
    }),
    /redeemTicket failed.*401/,
  );
});

test('redeemTicket: throws when sign-in is not complete', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /v1/client/sign_ins': {
      status: 200,
      body: { response: { status: 'needs_first_factor' }, client: { sessions: [] } },
    },
  });
  await assert.rejects(
    redeemTicket(clerkFetch, {
      fapiHost: FAPI_HOST,
      origin: 'https://x',
      ticket: 'y',
      timeoutMs: 5000,
    }),
    /sign-in not complete.*needs_first_factor/,
  );
});

test('redeemTicket: returns jwt=null when session created but no token present', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /v1/client/sign_ins': {
      status: 200,
      body: {
        response: { status: 'complete', created_session_id: SESSION_ID },
        client: { sessions: [] },
      },
    },
  });
  const result = await redeemTicket(clerkFetch, {
    fapiHost: FAPI_HOST,
    origin: 'https://x',
    ticket: 'y',
    timeoutMs: 5000,
  });
  assert.equal(result.sessionId, SESSION_ID);
  assert.equal(result.jwt, null);
});

test('redeemTicket: not complete but a session was created → returns jwt=null so it can be revoked', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /v1/client/sign_ins': {
      status: 200,
      body: {
        response: { status: 'needs_second_factor', created_session_id: SESSION_ID },
        client: { sessions: [] },
      },
    },
  });
  // Must NOT throw — the session exists server-side and would otherwise be
  // orphaned (un-revokable). The caller relies on the returned id to revoke it.
  const result = await redeemTicket(clerkFetch, {
    fapiHost: FAPI_HOST,
    origin: 'https://x',
    ticket: 'y',
    timeoutMs: 5000,
  });
  assert.equal(result.sessionId, SESSION_ID);
  assert.equal(result.jwt, null);
});

test('redeemTicket: error detail surfaces only Clerk code/message, never the raw body', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /v1/client/sign_ins': {
      status: 401,
      body: {
        errors: [{ code: 'authentication_invalid', message: 'Invalid ticket', long_message: 'x' }],
        // Fields that must never leak into the error message / evidence doc.
        session_token: 'SENSITIVE_JWT_FRAGMENT',
        client: { sessions: [{ id: 's', last_active_token: { jwt: 'LEAKED_JWT' } }] },
      },
    },
  });
  await assert.rejects(
    redeemTicket(clerkFetch, {
      fapiHost: FAPI_HOST,
      origin: 'https://x',
      ticket: 'y',
      timeoutMs: 5000,
    }),
    (error) => {
      assert.match(error.message, /redeemTicket failed.*401/);
      assert.match(error.message, /authentication_invalid/);
      assert.doesNotMatch(error.message, /LEAKED_JWT|SENSITIVE_JWT_FRAGMENT|long_message/);
      return true;
    },
  );
});

// ── revokeSession ───────────────────────────────────────────────────────

test('revokeSession: POSTs /sessions/{id}/revoke and returns revoked=true on success', async () => {
  const clerkFetch = makeClerkFetch(DEFAULT_CLERK_RESPONSES);
  const result = await revokeSession(clerkFetch, {
    secretKey: SECRET,
    sessionId: SESSION_ID,
    timeoutMs: 5000,
  });
  assert.equal(result.revoked, true);
  assert.equal(clerkFetch.calls[0].path, `/v1/sessions/${SESSION_ID}/revoke`);
});

test('revokeSession: returns revoked=false on non-2xx (does not throw)', async () => {
  const clerkFetch = makeClerkFetch({
    [`POST /v1/sessions/${SESSION_ID}/revoke`]: { status: 500, body: { error: 'server' } },
  });
  const result = await revokeSession(clerkFetch, {
    secretKey: SECRET,
    sessionId: SESSION_ID,
    timeoutMs: 5000,
  });
  assert.equal(result.revoked, false);
});

// ── Orchestration tests for runAuthenticatedSmoke ───────────────────────

test('runAuthenticatedSmoke: successful mint → probe → revoke exits 0', async () => {
  const clerkFetch = makeClerkFetch(DEFAULT_CLERK_RESPONSES);
  const smokeMain = makeSmokeMain(0);
  const io = makeIO();
  const code = await runAuthenticatedSmoke(BASE_ENV, {
    clerkFetch,
    smokeMain,
    stdout: io.stdout,
    stderr: io.stderr,
  });
  assert.equal(code, 0);
  assert.equal(smokeMain.calls.length, 1);
  assert.equal(smokeMain.calls[0].env.SMOKE_AUTH_TOKEN, JWT);
  const revokeCall = clerkFetch.calls.find((c) => c.path.endsWith('/revoke'));
  assert.ok(revokeCall, 'revoke was called');
  const evidence = JSON.parse(io.outChunks.join(''));
  assert.equal(evidence.smokeUserId, USER_ID);
  assert.equal(evidence.session.revoked, true);
  assert.equal(evidence.smokeExitCode, 0);
});

test('runAuthenticatedSmoke: probe failure still revokes and exits 1', async () => {
  const clerkFetch = makeClerkFetch(DEFAULT_CLERK_RESPONSES);
  const smokeMain = makeSmokeMain(1);
  const io = makeIO();
  const code = await runAuthenticatedSmoke(BASE_ENV, {
    clerkFetch,
    smokeMain,
    stdout: io.stdout,
    stderr: io.stderr,
  });
  assert.equal(code, 1);
  const revokeCall = clerkFetch.calls.find((c) => c.path.endsWith('/revoke'));
  assert.ok(revokeCall, 'revoke was called even after probe failure');
  const evidence = JSON.parse(io.outChunks.join(''));
  assert.equal(evidence.smokeExitCode, 1);
  assert.equal(evidence.session.revoked, true);
});

test('runAuthenticatedSmoke: sign-in-token failure exits 1 (no session to revoke)', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /v1/sign_in_tokens': { status: 403, body: { error: 'forbidden' } },
  });
  const smokeMain = makeSmokeMain(0);
  const io = makeIO();
  const code = await runAuthenticatedSmoke(BASE_ENV, {
    clerkFetch,
    smokeMain,
    stdout: io.stdout,
    stderr: io.stderr,
  });
  assert.equal(code, 1);
  assert.equal(smokeMain.calls.length, 0);
  const revokeCall = clerkFetch.calls.find((c) => c.path.endsWith('/revoke'));
  assert.equal(revokeCall, undefined);
  const evidence = JSON.parse(io.outChunks.join(''));
  assert.match(evidence.orchestrationError, /createSignInToken failed/);
});

test('runAuthenticatedSmoke: redeem failure exits 1 (no session to revoke)', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /v1/sign_in_tokens': { status: 200, body: { token: SIGN_IN_TOKEN } },
    'POST /v1/client/sign_ins': { status: 401, body: { error: 'bad ticket' } },
  });
  const smokeMain = makeSmokeMain(0);
  const io = makeIO();
  const code = await runAuthenticatedSmoke(BASE_ENV, {
    clerkFetch,
    smokeMain,
    stdout: io.stdout,
    stderr: io.stderr,
  });
  assert.equal(code, 1);
  assert.equal(smokeMain.calls.length, 0);
  const revokeCall = clerkFetch.calls.find((c) => c.path.endsWith('/revoke'));
  assert.equal(revokeCall, undefined);
  const evidence = JSON.parse(io.outChunks.join(''));
  assert.match(evidence.orchestrationError, /redeemTicket failed/);
});

test('runAuthenticatedSmoke: session created but no token → still revokes and exits 1', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /v1/sign_in_tokens': { status: 200, body: { token: SIGN_IN_TOKEN } },
    'POST /v1/client/sign_ins': {
      status: 200,
      body: {
        response: { status: 'complete', created_session_id: SESSION_ID },
        client: { sessions: [] },
      },
    },
    [`POST /v1/sessions/${SESSION_ID}/revoke`]: {
      status: 200,
      body: { id: SESSION_ID, status: 'revoked' },
    },
  });
  const smokeMain = makeSmokeMain(0);
  const io = makeIO();
  const code = await runAuthenticatedSmoke(BASE_ENV, {
    clerkFetch,
    smokeMain,
    stdout: io.stdout,
    stderr: io.stderr,
  });
  assert.equal(code, 1);
  assert.equal(smokeMain.calls.length, 0);
  const revokeCall = clerkFetch.calls.find((c) => c.path.endsWith('/revoke'));
  assert.ok(revokeCall, 'revoke was called for the orphaned session');
  const evidence = JSON.parse(io.outChunks.join(''));
  assert.match(evidence.orchestrationError, /no session token returned/);
});

test('runAuthenticatedSmoke: revoke failure is reported and fails the canary', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /v1/sign_in_tokens': { status: 200, body: { token: SIGN_IN_TOKEN } },
    'POST /v1/client/sign_ins': SIGN_INS_COMPLETE,
    [`POST /v1/sessions/${SESSION_ID}/revoke`]: { status: 500, body: { error: 'revoke failed' } },
  });
  const smokeMain = makeSmokeMain(0);
  const io = makeIO();
  const code = await runAuthenticatedSmoke(BASE_ENV, {
    clerkFetch,
    smokeMain,
    stdout: io.stdout,
    stderr: io.stderr,
  });
  assert.equal(code, 1);
  const evidence = JSON.parse(io.outChunks.join(''));
  assert.equal(evidence.session.revoked, false);
  assert.match(evidence.session.revocationError, /revokeSession failed/);
  assert.match(io.errChunks.join(''), /revocation failed/i);
});

test('runAuthenticatedSmoke: neither JWT, sign-in token, nor Clerk secret appears in output', async () => {
  const clerkFetch = makeClerkFetch(DEFAULT_CLERK_RESPONSES);
  const smokeMain = makeSmokeMain(0);
  const io = makeIO();
  await runAuthenticatedSmoke(BASE_ENV, {
    clerkFetch,
    smokeMain,
    stdout: io.stdout,
    stderr: io.stderr,
  });
  const allOutput = io.outChunks.join('') + io.errChunks.join('');
  assert.doesNotMatch(allOutput, /sk_test_secret_value_never_print/, 'secret must not appear');
  assert.doesNotMatch(allOutput, /eyJ\.eyJ\.eyJ_fake_jwt_never_print/, 'JWT must not appear');
  assert.doesNotMatch(allOutput, /sit_fake_ticket_never_print/, 'sign-in token must not appear');
});

test('runAuthenticatedSmoke: throws when CLERK_SECRET_KEY is missing', async () => {
  const io = makeIO();
  await assert.rejects(
    runAuthenticatedSmoke(
      {
        SMOKE_USER_ID: USER_ID,
        SMOKE_TARGET_URL: 'https://x',
        CLERK_FAPI_HOST: FAPI_HOST,
        FRONTEND_URL: 'https://a',
      },
      {
        clerkFetch: makeClerkFetch(),
        smokeMain: makeSmokeMain(0),
        stdout: io.stdout,
        stderr: io.stderr,
      },
    ),
    /CLERK_SECRET_KEY is required/,
  );
});

test('runAuthenticatedSmoke: throws when SMOKE_USER_ID is missing', async () => {
  const io = makeIO();
  await assert.rejects(
    runAuthenticatedSmoke(
      {
        CLERK_SECRET_KEY: SECRET,
        SMOKE_TARGET_URL: 'https://x',
        CLERK_FAPI_HOST: FAPI_HOST,
        FRONTEND_URL: 'https://a',
      },
      {
        clerkFetch: makeClerkFetch(),
        smokeMain: makeSmokeMain(0),
        stdout: io.stdout,
        stderr: io.stderr,
      },
    ),
    /SMOKE_USER_ID is required/,
  );
});

test('runAuthenticatedSmoke: throws when FAPI host cannot be resolved', async () => {
  const io = makeIO();
  await assert.rejects(
    runAuthenticatedSmoke(
      {
        CLERK_SECRET_KEY: SECRET,
        SMOKE_USER_ID: USER_ID,
        SMOKE_TARGET_URL: 'https://x',
        FRONTEND_URL: 'https://a',
      },
      {
        clerkFetch: makeClerkFetch(),
        smokeMain: makeSmokeMain(0),
        stdout: io.stdout,
        stderr: io.stderr,
      },
    ),
    /Frontend API host/,
  );
});

test('runAuthenticatedSmoke: throws when origin (FRONTEND_URL) is missing', async () => {
  const io = makeIO();
  await assert.rejects(
    runAuthenticatedSmoke(
      {
        CLERK_SECRET_KEY: SECRET,
        SMOKE_USER_ID: USER_ID,
        SMOKE_TARGET_URL: 'https://x',
        CLERK_FAPI_HOST: FAPI_HOST,
      },
      {
        clerkFetch: makeClerkFetch(),
        smokeMain: makeSmokeMain(0),
        stdout: io.stdout,
        stderr: io.stderr,
      },
    ),
    /azp/,
  );
});
