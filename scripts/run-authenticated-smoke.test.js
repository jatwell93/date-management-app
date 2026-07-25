const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runAuthenticatedSmoke,
  createSession,
  mintSessionToken,
  revokeSession,
} = require('./run-authenticated-smoke.js');

const CLERK_BASE = 'https://api.clerk.com/v1';
const SECRET = 'sk_test_secret_value_never_print';
const USER_ID = 'user_smoke_test_123';
const SESSION_ID = 'ses_abc456';
const JWT = 'eyJ.eyJ.eyJ_fake_jwt_never_print';

/**
 * Build a fake Clerk API fetch that responds to the three endpoints in the
 * canary lifecycle. Each response map is keyed by `${method} ${path}`.
 */
function makeClerkFetch(responses = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const path = url.replace(CLERK_BASE, '');
    calls.push({ url, method, path, body: opts.body });
    const key = `${method} ${path}`;
    const entry = responses[key];
    if (!entry) {
      return { ok: false, status: 404, json: async () => ({ error: 'not mocked' }) };
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
    // Write a minimal evidence doc to stdout so the wrapper can parse it.
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

const DEFAULT_CLERK_RESPONSES = {
  'POST /sessions': { status: 201, body: { id: SESSION_ID, user_id: USER_ID, status: 'active' } },
  [`POST /sessions/${SESSION_ID}/tokens`]: { status: 200, body: { object: 'token', jwt: JWT } },
  [`POST /sessions/${SESSION_ID}/revoke`]: {
    status: 200,
    body: { id: SESSION_ID, status: 'revoked' },
  },
};

const BASE_ENV = {
  CLERK_SECRET_KEY: SECRET,
  SMOKE_USER_ID: USER_ID,
  SMOKE_TARGET_URL: 'https://api.example.com',
};

// ── Unit tests for the three Clerk API helpers ──────────────────────────

test('createSession: POSTs to /sessions with Bearer secret and user_id body', async () => {
  const clerkFetch = makeClerkFetch(DEFAULT_CLERK_RESPONSES);
  const result = await createSession(clerkFetch, {
    secretKey: SECRET,
    userId: USER_ID,
    timeoutMs: 5000,
  });
  assert.equal(result.sessionId, SESSION_ID);
  assert.equal(result.userId, USER_ID);
  assert.equal(clerkFetch.calls.length, 1);
  assert.equal(clerkFetch.calls[0].method, 'POST');
  assert.equal(clerkFetch.calls[0].path, '/sessions');
  const body = JSON.parse(clerkFetch.calls[0].body);
  assert.equal(body.user_id, USER_ID);
});

test('createSession: throws on non-2xx response', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /sessions': { status: 400, body: { error: 'bad user' } },
  });
  await assert.rejects(
    createSession(clerkFetch, { secretKey: SECRET, userId: USER_ID, timeoutMs: 5000 }),
    /createSession failed.*400/,
  );
});

test('createSession: throws if returned session user_id does not match', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /sessions': {
      status: 201,
      body: { id: SESSION_ID, user_id: 'user_other', status: 'active' },
    },
  });
  await assert.rejects(
    createSession(clerkFetch, { secretKey: SECRET, userId: USER_ID, timeoutMs: 5000 }),
    /session user_id mismatch/,
  );
});

test('mintSessionToken: POSTs to /sessions/{id}/tokens and returns jwt', async () => {
  const clerkFetch = makeClerkFetch(DEFAULT_CLERK_RESPONSES);
  const result = await mintSessionToken(clerkFetch, {
    secretKey: SECRET,
    sessionId: SESSION_ID,
    timeoutMs: 5000,
  });
  assert.equal(result.token, JWT);
  assert.equal(clerkFetch.calls[0].path, `/sessions/${SESSION_ID}/tokens`);
});

test('mintSessionToken: throws on non-2xx', async () => {
  const clerkFetch = makeClerkFetch({
    [`POST /sessions/${SESSION_ID}/tokens`]: { status: 403, body: { error: 'forbidden' } },
  });
  await assert.rejects(
    mintSessionToken(clerkFetch, { secretKey: SECRET, sessionId: SESSION_ID, timeoutMs: 5000 }),
    /mintSessionToken failed.*403/,
  );
});

test('revokeSession: POSTs to /sessions/{id}/revoke and returns revoked=true on success', async () => {
  const clerkFetch = makeClerkFetch(DEFAULT_CLERK_RESPONSES);
  const result = await revokeSession(clerkFetch, {
    secretKey: SECRET,
    sessionId: SESSION_ID,
    timeoutMs: 5000,
  });
  assert.equal(result.revoked, true);
  assert.equal(clerkFetch.calls[0].path, `/sessions/${SESSION_ID}/revoke`);
});

test('revokeSession: returns revoked=false on non-2xx (does not throw)', async () => {
  const clerkFetch = makeClerkFetch({
    [`POST /sessions/${SESSION_ID}/revoke`]: { status: 500, body: { error: 'server' } },
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
  // smokeMain was called once with the JWT as SMOKE_AUTH_TOKEN
  assert.equal(smokeMain.calls.length, 1);
  assert.equal(smokeMain.calls[0].env.SMOKE_AUTH_TOKEN, JWT);
  // session was revoked
  const revokeCall = clerkFetch.calls.find((c) => c.path.endsWith('/revoke'));
  assert.ok(revokeCall, 'revoke was called');
  // evidence was emitted on stdout
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
  // revocation still happened
  const revokeCall = clerkFetch.calls.find((c) => c.path.endsWith('/revoke'));
  assert.ok(revokeCall, 'revoke was called even after probe failure');
  const evidence = JSON.parse(io.outChunks.join(''));
  assert.equal(evidence.smokeExitCode, 1);
  assert.equal(evidence.session.revoked, true);
});

test('runAuthenticatedSmoke: token mint failure exits 1 (no session to revoke is fine)', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /sessions': { status: 201, body: { id: SESSION_ID, user_id: USER_ID, status: 'active' } },
    [`POST /sessions/${SESSION_ID}/tokens`]: { status: 500, body: { error: 'mint failed' } },
    [`POST /sessions/${SESSION_ID}/revoke`]: {
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
  // smokeMain was never called (mint failed before probing)
  assert.equal(smokeMain.calls.length, 0);
  // session was still revoked (created but mint failed → cleanup)
  const revokeCall = clerkFetch.calls.find((c) => c.path.endsWith('/revoke'));
  assert.ok(revokeCall, 'revoke was called even after mint failure');
  const evidence = JSON.parse(io.outChunks.join(''));
  assert.match(evidence.orchestrationError, /mintSessionToken failed/);
});

test('runAuthenticatedSmoke: revoke failure is reported and fails the canary', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /sessions': { status: 201, body: { id: SESSION_ID, user_id: USER_ID, status: 'active' } },
    [`POST /sessions/${SESSION_ID}/tokens`]: { status: 200, body: { object: 'token', jwt: JWT } },
    [`POST /sessions/${SESSION_ID}/revoke`]: { status: 500, body: { error: 'revoke failed' } },
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
  // stderr warns about revocation failure
  assert.match(io.errChunks.join(''), /revocation failed/i);
});

test('runAuthenticatedSmoke: neither JWT nor Clerk secret appears in stdout, stderr, or evidence', async () => {
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
  assert.doesNotMatch(
    allOutput,
    /sk_test_secret_value_never_print/,
    'secret must not appear in output',
  );
  assert.doesNotMatch(
    allOutput,
    /eyJ\.eyJ\.eyJ_fake_jwt_never_print/,
    'JWT must not appear in output',
  );
});

test('runAuthenticatedSmoke: createSession failure exits 1 (no session to revoke)', async () => {
  const clerkFetch = makeClerkFetch({
    'POST /sessions': { status: 403, body: { error: 'forbidden' } },
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
  // no revoke call (no session was created)
  const revokeCall = clerkFetch.calls.find((c) => c.path.endsWith('/revoke'));
  assert.equal(revokeCall, undefined);
  const evidence = JSON.parse(io.outChunks.join(''));
  assert.match(evidence.orchestrationError, /createSession failed/);
});

test('runAuthenticatedSmoke: throws when CLERK_SECRET_KEY is missing', async () => {
  const io = makeIO();
  await assert.rejects(
    runAuthenticatedSmoke(
      { SMOKE_USER_ID: USER_ID, SMOKE_TARGET_URL: 'https://x' },
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
      { CLERK_SECRET_KEY: SECRET, SMOKE_TARGET_URL: 'https://x' },
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

test('runAuthenticatedSmoke: each call creates a fresh session (no reuse)', async () => {
  const clerkFetch = makeClerkFetch(DEFAULT_CLERK_RESPONSES);
  const smokeMain = makeSmokeMain(0);
  const io1 = makeIO();
  await runAuthenticatedSmoke(BASE_ENV, {
    clerkFetch,
    smokeMain,
    stdout: io1.stdout,
    stderr: io1.stderr,
  });
  const io2 = makeIO();
  await runAuthenticatedSmoke(BASE_ENV, {
    clerkFetch,
    smokeMain,
    stdout: io2.stdout,
    stderr: io2.stderr,
  });
  // Two create-session calls (one per run)
  const createCalls = clerkFetch.calls.filter((c) => c.path === '/sessions');
  assert.equal(createCalls.length, 2, 'each run must create its own session');
  // Two revoke calls
  const revokeCalls = clerkFetch.calls.filter((c) => c.path.endsWith('/revoke'));
  assert.equal(revokeCalls.length, 2, 'each run must revoke its own session');
});
