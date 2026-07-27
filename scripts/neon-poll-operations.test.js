const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractOperationIds,
  extractOperationStatus,
  pollOperation,
  main,
  DEFAULT_DEADLINE_MINUTES,
  DEFAULT_INTERVAL_SECONDS,
  DEFAULT_PER_REQUEST_TIMEOUT_MS,
} = require('./neon-poll-operations.js');

/**
 * A signal factory that never fires — for tests where fetch resolves
 * immediately and the signal should never abort. Returns a signal from
 * an AbortController that is never aborted.
 */
function noopSignalFactory() {
  return new AbortController().signal;
}

/**
 * A signal factory that fires on the next event loop iteration via
 * setImmediate. Used by stalled-fetch tests that need the signal to
 * actually abort. setImmediate is ref'd so it keeps the event loop
 * alive until the callback fires, unlike unref'd timers which let the
 * test runner drain the event loop prematurely.
 */
function immediateAbortSignal(_ms) {
  const controller = new AbortController();
  setImmediate(() => controller.abort(new Error('test abort')));
  return controller.signal;
}

/**
 * Build a fake fetch that returns a scripted sequence of responses per op ID.
 * Each entry in `script[opId]` is consumed in order; the last is reused if
 * the poller keeps asking.
 * @param {Record<string, Array<{ status?: number; ok?: boolean; body?: unknown }>>} script
 * @param {Array<{ url: string; status?: number; body?: unknown }>} [extra]
 */
function makeFetch(script, extra) {
  const calls = [];
  const extraMap = extra ? Object.fromEntries(extra.map((e) => [e.url, e])) : {};
  const fn = async (url) => {
    calls.push(url);
    if (extraMap[url]) {
      const e = extraMap[url];
      return {
        ok: e.status === undefined || e.status < 400,
        status: e.status === undefined ? 200 : e.status,
        json: async () => e.body,
        text: async () => JSON.stringify(e.body ?? {}),
      };
    }
    // Match /operations/{id}
    const m = url.match(/\/operations\/([^/?]+)$/);
    const opId = m ? m[1] : null;
    const seq = opId ? script[opId] : null;
    if (!seq) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    }
    const idx = (fn._idx[opId] = fn._idx[opId] || 0);
    const entry = seq[Math.min(idx, seq.length - 1)];
    fn._idx[opId] = idx + 1;
    return {
      ok: entry.status === undefined || entry.status < 400,
      status: entry.status === undefined ? 200 : entry.status,
      json: async () => entry.body ?? {},
      text: async () => JSON.stringify(entry.body ?? {}),
    };
  };
  fn._idx = {};
  fn.calls = calls;
  return fn;
}

function makeStdio() {
  const stdout = [];
  const stderr = [];
  return {
    stdout: { write: (s) => stdout.push(s) },
    stderr: { write: (s) => stderr.push(s) },
    stdoutStr: () => stdout.join(''),
    stderrStr: () => stderr.join(''),
  };
}

function makeStdin(payload) {
  const buf = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  // An async iterable that yields the buffer once.
  return {
    async *[Symbol.asyncIterator]() {
      yield buf;
    },
  };
}

test('extractOperationIds: pulls IDs from { operations: [...] }', () => {
  const ids = extractOperationIds({
    operations: [{ id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' }],
  });
  assert.deepEqual(ids, ['op-1', 'op-2', 'op-3']);
});

test('extractOperationIds: skips entries without a string id', () => {
  const ids = extractOperationIds({
    operations: [{ id: 'op-1' }, { id: 42 }, { id: '' }, { noId: true }, null, 'str'],
  });
  assert.deepEqual(ids, ['op-1']);
});

test('extractOperationIds: returns empty array for unexpected payload shapes', () => {
  assert.deepEqual(extractOperationIds(null), []);
  assert.deepEqual(extractOperationIds({}), []);
  assert.deepEqual(extractOperationIds({ operations: 'not-an-array' }), []);
  assert.deepEqual(extractOperationIds({ operations: [] }), []);
});

test('extractOperationStatus: reads { operation: { status } }', () => {
  assert.equal(extractOperationStatus({ operation: { status: 'finished' } }), 'finished');
});

test('extractOperationStatus: reads bare { status }', () => {
  assert.equal(extractOperationStatus({ status: 'running' }), 'running');
});

test('extractOperationStatus: returns "unknown" for malformed payloads', () => {
  assert.equal(extractOperationStatus(null), 'unknown');
  assert.equal(extractOperationStatus({}), 'unknown');
  assert.equal(extractOperationStatus({ operation: 'not-an-object' }), 'unknown');
  assert.equal(extractOperationStatus({ operation: { status: 123 } }), 'unknown');
  assert.equal(extractOperationStatus({ operation: { status: '' } }), 'unknown');
});

test('pollOperation: returns success when status reaches finished', async () => {
  let ticks = 0;
  const nowMs = () => 1000 + ticks * 1000; // 1s, 2s, 3s...
  const fetchImpl = makeFetch({
    'op-1': [
      { body: { operation: { status: 'running' } } },
      { body: { operation: { status: 'running' } } },
      { body: { operation: { status: 'finished' } } },
    ],
  });
  const err = [];
  const result = await pollOperation({
    projectId: 'proj',
    apiKey: 'key',
    opId: 'op-1',
    deadlineMs: 100000,
    intervalMs: 1,
    fetchImpl,
    createSignal: noopSignalFactory,
    nowMs,
    sleep: async () => {
      ticks += 1;
    },
    stderr: { write: (s) => err.push(s) },
  });
  assert.equal(result.outcome, 'success');
  assert.equal(result.status, 'finished');
  assert.equal(result.polls, 3);
});

test('pollOperation: returns success for skipped and cancelled terminal states', async () => {
  for (const terminal of ['skipped', 'cancelled']) {
    const fetchImpl = makeFetch({
      'op-x': [{ body: { operation: { status: terminal } } }],
    });
    const result = await pollOperation({
      projectId: 'proj',
      apiKey: 'key',
      opId: 'op-x',
      deadlineMs: 100000,
      intervalMs: 1,
      fetchImpl,
      nowMs: () => 1000,
      sleep: async () => {},
      stderr: { write: () => {} },
    });
    assert.equal(result.outcome, 'success');
    assert.equal(result.status, terminal);
  }
});

test('pollOperation: returns failed when status is failed', async () => {
  const fetchImpl = makeFetch({
    'op-1': [
      { body: { operation: { status: 'running' } } },
      { body: { operation: { status: 'failed' } } },
    ],
  });
  let ticks = 0;
  const result = await pollOperation({
    projectId: 'proj',
    apiKey: 'key',
    opId: 'op-1',
    deadlineMs: 100000,
    intervalMs: 1,
    fetchImpl,
    nowMs: () => 1000 + ticks * 1000,
    sleep: async () => {
      ticks += 1;
    },
    stderr: { write: () => {} },
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.status, 'failed');
  assert.equal(result.polls, 2);
});

test('pollOperation: returns failed on non-2xx HTTP response', async () => {
  const fetchImpl = makeFetch({
    'op-1': [{ status: 401, body: { message: 'unauthorized' } }],
  });
  const err = [];
  const result = await pollOperation({
    projectId: 'proj',
    apiKey: 'key',
    opId: 'op-1',
    deadlineMs: 100000,
    intervalMs: 1,
    fetchImpl,
    nowMs: () => 1000,
    sleep: async () => {},
    stderr: { write: (s) => err.push(s) },
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.status, 'http_401');
  assert.match(err.join(''), /returned 401/);
});

test('pollOperation: returns deadline when clock passes deadline before terminal state', async () => {
  let ticks = 0;
  const nowMs = () => 1000 + ticks * 1000; // 1s, 2s, 3s...
  const fetchImpl = makeFetch({
    'op-1': new Array(10).fill({ body: { operation: { status: 'running' } } }),
  });
  const result = await pollOperation({
    projectId: 'proj',
    apiKey: 'key',
    opId: 'op-1',
    deadlineMs: 2500, // deadline at tick 1.5
    intervalMs: 1,
    fetchImpl,
    createSignal: noopSignalFactory,
    nowMs,
    sleep: async () => {
      ticks += 1;
    },
    stderr: { write: () => {} },
  });
  assert.equal(result.outcome, 'deadline');
  assert.equal(result.status, 'running');
});

test('pollOperation: retries after a fetch throw instead of aborting', async () => {
  let ticks = 0;
  const nowMs = () => 1000 + ticks * 1000;
  let throwOnce = true;
  const fetchImpl = async () => {
    if (throwOnce) {
      throwOnce = false;
      throw new Error('ECONNRESET');
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ operation: { status: 'finished' } }),
      text: async () => '{}',
    };
  };
  const err = [];
  const result = await pollOperation({
    projectId: 'proj',
    apiKey: 'key',
    opId: 'op-1',
    deadlineMs: 100000,
    intervalMs: 1,
    fetchImpl,
    createSignal: noopSignalFactory,
    nowMs,
    sleep: async () => {
      ticks += 1;
    },
    stderr: { write: (s) => err.push(s) },
  });
  assert.equal(result.outcome, 'success');
  assert.equal(result.status, 'finished');
  assert.match(err.join(''), /ECONNRESET/);
});

test('main: exits 0 when all operations reach finished', async () => {
  const io = makeStdio();
  const fetchImpl = makeFetch({
    'op-a': [{ body: { operation: { status: 'finished' } } }],
    'op-b': [{ body: { operation: { status: 'finished' } } }],
  });
  const code = await main(
    { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj' },
    {
      fetch: fetchImpl,
      nowMs: () => 1000,
      sleep: async () => {},
      createSignal: noopSignalFactory,
      stdin: makeStdin({ operations: [{ id: 'op-a' }, { id: 'op-b' }] }),
      stdout: io.stdout,
      stderr: io.stderr,
    },
  );
  assert.equal(code, 0);
  const evidence = JSON.parse(io.stdoutStr());
  assert.equal(evidence.ok, true);
  assert.equal(evidence.operationCount, 2);
  assert.equal(evidence.results.length, 2);
  assert.equal(evidence.results[0].opId, 'op-a');
  assert.equal(evidence.results[1].opId, 'op-b');
  assert.match(io.stderrStr(), /All restore operations complete/);
});

test('main: exits 1 when restore response has no operation IDs', async () => {
  const io = makeStdio();
  const fetchImpl = makeFetch({});
  const code = await main(
    { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj' },
    {
      fetch: fetchImpl,
      nowMs: () => 1000,
      sleep: async () => {},
      createSignal: noopSignalFactory,
      stdin: makeStdin({ operations: [] }),
      stdout: io.stdout,
      stderr: io.stderr,
    },
  );
  assert.equal(code, 1);
  const evidence = JSON.parse(io.stdoutStr());
  assert.equal(evidence.ok, false);
  assert.equal(evidence.operationCount, 0);
  assert.match(io.stderrStr(), /no operation IDs/);
  // Must not have polled anything
  assert.equal(fetchImpl.calls.length, 0);
});

test('main: exits 1 when an operation fails (and stops polling remaining ops)', async () => {
  const io = makeStdio();
  const fetchImpl = makeFetch({
    'op-a': [{ body: { operation: { status: 'failed' } } }],
    'op-b': [{ body: { operation: { status: 'finished' } } }],
  });
  const code = await main(
    { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj' },
    {
      fetch: fetchImpl,
      nowMs: () => 1000,
      sleep: async () => {},
      createSignal: noopSignalFactory,
      stdin: makeStdin({ operations: [{ id: 'op-a' }, { id: 'op-b' }] }),
      stdout: io.stdout,
      stderr: io.stderr,
    },
  );
  assert.equal(code, 1);
  const evidence = JSON.parse(io.stdoutStr());
  assert.equal(evidence.ok, false);
  assert.equal(evidence.results.length, 1);
  assert.equal(evidence.results[0].opId, 'op-a');
  assert.equal(evidence.results[0].outcome, 'failed');
  // op-b must NOT have been polled because we abort on first failure
  assert.equal(
    fetchImpl.calls.some((u) => u.endsWith('/operations/op-b')),
    false,
    'Must stop polling after a failed operation',
  );
  assert.match(io.stderrStr(), /did not reach a successful terminal state/);
});

test('main: exits 1 when the deadline is exceeded', async () => {
  const io = makeStdio();
  let ticks = 0;
  const nowMs = () => 1000 + ticks * 1000;
  const fetchImpl = makeFetch({
    'op-a': new Array(20).fill({ body: { operation: { status: 'running' } } }),
  });
  const code = await main(
    {
      NEON_API_KEY: 'key',
      NEON_PROJECT_ID: 'proj',
      NEON_POLL_DEADLINE_MINUTES: '0.0001', // ~6ms deadline
    },
    {
      fetch: fetchImpl,
      nowMs,
      sleep: async () => {
        ticks += 1;
      },
      stdin: makeStdin({ operations: [{ id: 'op-a' }] }),
      stdout: io.stdout,
      stderr: io.stderr,
    },
  );
  assert.equal(code, 1);
  const evidence = JSON.parse(io.stdoutStr());
  assert.equal(evidence.ok, false);
  assert.equal(evidence.results[0].outcome, 'deadline');
});

test('main: exits 1 when stdin is not valid JSON', async () => {
  const io = makeStdio();
  const fetchImpl = makeFetch({});
  const code = await main(
    { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj' },
    {
      fetch: fetchImpl,
      nowMs: () => 1000,
      sleep: async () => {},
      createSignal: noopSignalFactory,
      stdin: makeStdin('not-json{'),
      stdout: io.stdout,
      stderr: io.stderr,
    },
  );
  assert.equal(code, 1);
  const evidence = JSON.parse(io.stdoutStr());
  assert.equal(evidence.ok, false);
  assert.match(evidence.reason, /JSON parse error/);
  assert.match(io.stderrStr(), /did not contain valid JSON/);
});

test('main: exits 1 when stdin is empty', async () => {
  const io = makeStdio();
  const fetchImpl = makeFetch({});
  const code = await main(
    { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj' },
    {
      fetch: fetchImpl,
      nowMs: () => 1000,
      sleep: async () => {},
      createSignal: noopSignalFactory,
      stdin: makeStdin(''),
      stdout: io.stdout,
      stderr: io.stderr,
    },
  );
  assert.equal(code, 1);
  const evidence = JSON.parse(io.stdoutStr());
  assert.equal(evidence.ok, false);
  assert.match(evidence.reason, /no operation IDs/);
});

test('main: throws when NEON_API_KEY is missing', async () => {
  await assert.rejects(
    main(
      { NEON_PROJECT_ID: 'proj' },
      {
        fetch: makeFetch({}),
        nowMs: () => 1000,
        sleep: async () => {},
        stdin: makeStdin({ operations: [] }),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      },
    ),
    /NEON_API_KEY is required/,
  );
});

test('main: throws when NEON_PROJECT_ID is missing', async () => {
  await assert.rejects(
    main(
      { NEON_API_KEY: 'key' },
      {
        fetch: makeFetch({}),
        nowMs: () => 1000,
        sleep: async () => {},
        stdin: makeStdin({ operations: [] }),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      },
    ),
    /NEON_PROJECT_ID is required/,
  );
});

test('main: throws when NEON_POLL_DEADLINE_MINUTES is invalid', async () => {
  await assert.rejects(
    main(
      { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj', NEON_POLL_DEADLINE_MINUTES: 'not-a-number' },
      {
        fetch: makeFetch({}),
        nowMs: () => 1000,
        sleep: async () => {},
        stdin: makeStdin({ operations: [] }),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      },
    ),
    /NEON_POLL_DEADLINE_MINUTES must be a positive number/,
  );
});

test('main: throws when NEON_POLL_INTERVAL_SECONDS is invalid', async () => {
  await assert.rejects(
    main(
      { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj', NEON_POLL_INTERVAL_SECONDS: '0' },
      {
        fetch: makeFetch({}),
        nowMs: () => 1000,
        sleep: async () => {},
        stdin: makeStdin({ operations: [] }),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      },
    ),
    /NEON_POLL_INTERVAL_SECONDS must be a positive number/,
  );
});

test('main: uses default deadline, interval, and per-request timeout when env vars unset', async () => {
  const io = makeStdio();
  const fetchImpl = makeFetch({
    'op-a': [{ body: { operation: { status: 'finished' } } }],
  });
  const code = await main(
    { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj' },
    {
      fetch: fetchImpl,
      nowMs: () => 1000,
      sleep: async () => {},
      createSignal: noopSignalFactory,
      stdin: makeStdin({ operations: [{ id: 'op-a' }] }),
      stdout: io.stdout,
      stderr: io.stderr,
    },
  );
  assert.equal(code, 0);
  const evidence = JSON.parse(io.stdoutStr());
  assert.equal(evidence.deadlineMinutes, DEFAULT_DEADLINE_MINUTES);
  assert.equal(evidence.intervalSeconds, DEFAULT_INTERVAL_SECONDS);
  assert.equal(evidence.perRequestTimeoutMs, DEFAULT_PER_REQUEST_TIMEOUT_MS);
});

test('main: throws when NEON_POLL_PER_REQUEST_TIMEOUT_MS is invalid', async () => {
  await assert.rejects(
    main(
      { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj', NEON_POLL_PER_REQUEST_TIMEOUT_MS: '0' },
      {
        fetch: makeFetch({}),
        nowMs: () => 1000,
        sleep: async () => {},
        stdin: makeStdin({ operations: [] }),
        stdout: { write: () => {} },
        stderr: { write: () => {} },
      },
    ),
    /NEON_POLL_PER_REQUEST_TIMEOUT_MS must be a positive number/,
  );
});

test('pollOperation: passes an AbortSignal to fetch that fires on per-request timeout', async () => {
  // A stalled fetch that NEVER resolves on its own — it only rejects
  // when its signal aborts. This verifies the signal is actually passed
  // and that a hung HTTP request cannot outlive the per-request timeout.
  // After the first abort, the retry resolves so the test is bounded.
  let receivedSignals = [];
  let ticks = 0;
  const nowMs = () => 1000 + ticks * 100;
  let attempts = 0;
  const fetchImpl = (url, opts) => {
    attempts += 1;
    receivedSignals.push(opts && opts.signal);
    if (attempts === 1) {
      // First call: stalled — only the signal abort can reject it.
      return new Promise((_resolve, reject) => {
        const sig = opts && opts.signal;
        if (sig) {
          sig.addEventListener('abort', () => {
            const e = new Error('The operation was aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }
      });
    }
    // Second call: resolve immediately so the test ends.
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ operation: { status: 'finished' } }),
      text: async () => '{}',
    });
  };
  const err = [];
  const result = await pollOperation({
    projectId: 'proj',
    apiKey: 'key',
    opId: 'op-stalled',
    deadlineMs: 999999, // far away — the per-request timeout must fire first
    intervalMs: 1,
    perRequestTimeoutMs: 50, // 50ms — smaller than the overall deadline
    fetchImpl,
    createSignal: immediateAbortSignal,
    nowMs,
    sleep: async () => {
      ticks += 1;
    },
    stderr: { write: (s) => err.push(s) },
  });
  // The first fetch must have received an AbortSignal that was aborted.
  assert.ok(receivedSignals.length >= 1, 'fetch must have been called');
  assert.ok(receivedSignals[0], 'fetch must receive an AbortSignal');
  assert.ok(receivedSignals[0].aborted, 'the first signal must have been aborted');
  // The error log must mention the timeout.
  assert.match(err.join(''), /timed out/);
  // The retry succeeds.
  assert.equal(result.outcome, 'success');
  assert.equal(result.status, 'finished');
  assert.equal(result.polls, 2); // 1 aborted + 1 success
});

test('pollOperation: a stalled fetch is aborted by the per-request timeout, not the overall deadline', async () => {
  // The per-request timeout (50ms) is MUCH smaller than the overall
  // deadline (10s). A stalled fetch must be aborted by the per-request
  // timeout, proving the min(remaining, perReq) logic picks the smaller.
  let abortReason = null;
  let ticks = 0;
  const nowMs = () => 1000 + ticks * 100;
  const fetchImpl = (_url, opts) => {
    return new Promise((_resolve, reject) => {
      const sig = opts && opts.signal;
      if (sig) {
        sig.addEventListener('abort', () => {
          abortReason = sig.reason;
          const e = new Error('aborted');
          e.name = 'TimeoutError';
          reject(e);
        });
      }
    });
  };
  const err = [];
  // After 3 aborts, switch to a resolving fetch to end the test.
  let attempts = 0;
  const fetchWrapper = async (url, opts) => {
    attempts += 1;
    if (attempts <= 3) {
      return fetchImpl(url, opts);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ operation: { status: 'finished' } }),
      text: async () => '{}',
    };
  };
  const result = await pollOperation({
    projectId: 'proj',
    apiKey: 'key',
    opId: 'op-stalled-2',
    deadlineMs: 11000, // far away — per-request timeout must fire first
    intervalMs: 1,
    perRequestTimeoutMs: 50, // 50ms — much smaller than the 10s remaining
    fetchImpl: fetchWrapper,
    createSignal: immediateAbortSignal,
    nowMs,
    sleep: async () => {
      ticks += 1;
    },
    stderr: { write: (s) => err.push(s) },
  });
  assert.equal(result.outcome, 'success');
  assert.equal(result.status, 'finished');
  // The first 3 attempts must have been aborted by the signal.
  assert.ok(abortReason, 'the signal must have been aborted at least once');
  assert.match(err.join(''), /timed out/);
  // 3 aborted attempts + 1 successful poll = 4 polls total.
  assert.equal(result.polls, 4);
});

test('pollOperation: per-request timeout uses the smaller of remaining deadline and perReqMs', async () => {
  // When the remaining deadline (200ms) is SMALLER than perReqMs (5000ms),
  // the signal timeout must be 200ms, not 5000ms. We verify by capturing
  // the ms argument passed to the signal factory.
  let capturedMs = null;
  const nowMs = () => 1000; // fixed clock — deadline check uses this
  const capturingSignalFactory = (ms) => {
    capturedMs = ms;
    // Return a signal that never fires — fetch resolves immediately.
    return new AbortController().signal;
  };
  const fetchImpl = (_url, _opts) => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ operation: { status: 'finished' } }),
      text: async () => '{}',
    });
  };
  const result = await pollOperation({
    projectId: 'proj',
    apiKey: 'key',
    opId: 'op-min',
    deadlineMs: 1200, // remaining = 1200 - 1000 = 200ms
    intervalMs: 1,
    perRequestTimeoutMs: 5000, // larger than remaining (200ms)
    fetchImpl,
    createSignal: capturingSignalFactory,
    nowMs,
    sleep: async () => {},
    stderr: { write: () => {} },
  });
  assert.equal(result.outcome, 'success');
  assert.equal(capturedMs, 200, 'signal timeout must be min(remaining=200, perReq=5000) = 200');
});

test('pollOperation: per-request timeout uses perReqMs when it is smaller than remaining', async () => {
  // When perReqMs (50ms) is SMALLER than the remaining deadline (10000ms),
  // the signal timeout must be 50ms, not 10000ms.
  let capturedMs = null;
  const nowMs = () => 1000;
  const capturingSignalFactory = (ms) => {
    capturedMs = ms;
    return new AbortController().signal;
  };
  const fetchImpl = (_url, _opts) => {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ operation: { status: 'finished' } }),
      text: async () => '{}',
    });
  };
  const result = await pollOperation({
    projectId: 'proj',
    apiKey: 'key',
    opId: 'op-min-2',
    deadlineMs: 11000, // remaining = 10000ms
    intervalMs: 1,
    perRequestTimeoutMs: 50, // smaller than remaining
    fetchImpl,
    createSignal: capturingSignalFactory,
    nowMs,
    sleep: async () => {},
    stderr: { write: () => {} },
  });
  assert.equal(result.outcome, 'success');
  assert.equal(capturedMs, 50, 'signal timeout must be min(remaining=10000, perReq=50) = 50');
});

test('main: polls sequentially and stops at first failure (subshell-bug regression)', async () => {
  // Regression guard for the Bash subshell bug: a failed operation must
  // abort the whole process, not just the loop body. In Node the control
  // flow is in-process, so exit 1 propagates.
  const io = makeStdio();
  const fetchImpl = makeFetch({
    'op-1': [{ body: { operation: { status: 'failed' } } }],
    'op-2': [{ body: { operation: { status: 'finished' } } }],
    'op-3': [{ body: { operation: { status: 'finished' } } }],
  });
  const code = await main(
    { NEON_API_KEY: 'key', NEON_PROJECT_ID: 'proj' },
    {
      fetch: fetchImpl,
      nowMs: () => 1000,
      sleep: async () => {},
      createSignal: noopSignalFactory,
      stdin: makeStdin({ operations: [{ id: 'op-1' }, { id: 'op-2' }, { id: 'op-3' }] }),
      stdout: io.stdout,
      stderr: io.stderr,
    },
  );
  assert.equal(code, 1);
  // Only op-1 should have been polled
  assert.equal(
    fetchImpl.calls.some((u) => u.endsWith('/operations/op-2')),
    false,
  );
  assert.equal(
    fetchImpl.calls.some((u) => u.endsWith('/operations/op-3')),
    false,
  );
});
