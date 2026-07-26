#!/usr/bin/env node
/**
 * Phase 1 task 1.7 — Neon restore operation poller.
 *
 * After a Neon snapshot-restore call (`POST .../snapshots/{id}/restore`), the
 * API returns an `operations` array whose IDs must each reach a terminal
 * state (`finished`, `skipped`, `cancelled`) before the restored branch is
 * connectable. Polling them in a Bash `while read` loop on the right side of
 * a pipeline runs in a subshell, so an `exit 1` on a failed operation exits
 * only the subshell — without `set -o pipefail`, execution can continue past
 * "All restore operations complete." and operate against production.
 *
 * This script replaces that pattern. It reads the restore response JSON from
 * stdin, extracts the operation IDs itself (failing closed if there are
 * none), and polls each one with a bounded deadline so an unknown or
 * permanently-running status cannot loop forever. Control flow lives in
 * Node, not a subshell, so a failure aborts the whole process.
 *
 * Usage:
 *   cat restore-response.json | node scripts/neon-poll-operations.js
 *   echo "$RESTORE_RESPONSE" | node scripts/neon-poll-operations.js
 *
 * Environment variables:
 *   NEON_API_KEY              — Neon API key (read-only is sufficient)
 *   NEON_PROJECT_ID           — the Neon project ID
 *   NEON_POLL_DEADLINE_MINUTES — max wall-clock minutes to wait for all
 *                                operations to reach a terminal state (default 15)
 *   NEON_POLL_INTERVAL_SECONDS — sleep between polls of a single operation (default 10)
 *
 * Exit codes:
 *   0 — every operation reached a successful terminal state
 *   1 — no operation IDs in the response, an operation failed, or the deadline was exceeded
 *
 * Output: a JSON evidence document on stdout suitable for runbook records.
 */

const NEON_API_BASE = 'https://console.neon.tech/api/v2';
const DEFAULT_DEADLINE_MINUTES = 15;
const DEFAULT_INTERVAL_SECONDS = 10;
const SUCCESS_STATES = new Set(['finished', 'skipped', 'cancelled']);

/**
 * Extract operation IDs from a Neon restore API response.
 *
 * The restore endpoint returns `{ operations: [{ id, ... }, ...] }`. We
 * extract defensively so a shape change fails closed rather than silently
 * treating an empty list as "nothing to wait for".
 * @param {unknown} payload
 * @returns {string[]}
 */
function extractOperationIds(payload) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  const ops = Array.isArray(obj.operations) ? obj.operations : [];
  const ids = [];
  for (const op of ops) {
    if (op && typeof op === 'object' && typeof op.id === 'string' && op.id.length > 0) {
      ids.push(op.id);
    }
  }
  return ids;
}

/**
 * Extract the status string from a Neon operation GET response.
 *
 * The operation endpoint returns either `{ operation: { status, ... } }` or
 * a bare `{ status, ... }`. We accept both and default to `"unknown"` so the
 * poller keeps waiting (and eventually hits the deadline) rather than
 * treating a malformed response as success.
 * @param {unknown} payload
 * @returns {string}
 */
function extractOperationStatus(payload) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  const op = obj.operation && typeof obj.operation === 'object' ? obj.operation : obj;
  const status = op.status;
  return typeof status === 'string' && status.length > 0 ? status : 'unknown';
}

/**
 * Per-request HTTP timeout (ms). Each fetch is aborted if it does not
 * complete within this window, so a stalled connection cannot hang
 * indefinitely even when the overall deadline is far away. The actual
 * per-request timeout used is the SMALLER of this value and the
 * remaining time to the overall deadline.
 */
const DEFAULT_PER_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Create an AbortSignal that fires after `ms` milliseconds. Uses
 * AbortController + setTimeout with unref() so the timer does not keep
 * the process alive on its own (the await on fetch keeps the event loop
 * alive while the request is in flight; if the process is otherwise
 * idle, the unref'd timer lets it exit cleanly).
 * @param {number} ms
 * @returns {AbortSignal}
 */
function createTimeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${ms}ms`)),
    ms,
  );
  // unref so the timer does not keep the event loop alive on its own.
  if (typeof timer.unref === 'function') timer.unref();
  return controller.signal;
}

/**
 * Poll a single operation ID until it reaches a terminal state or the deadline expires.
 * @param {object} args
 * @param {string} args.projectId
 * @param {string} args.apiKey
 * @param {string} args.opId
 * @param {number} args.deadlineMs  — absolute wall-clock deadline (epoch ms)
 * @param {number} args.intervalMs  — sleep between polls
 * @param {typeof fetch} [args.fetchImpl]
 * @param {() => number} [args.nowMs] — epoch ms clock (injectable for tests)
 * @param {(ms: number) => Promise<void>} [args.sleep] — sleep (injectable for tests)
 * @param {number} [args.perRequestTimeoutMs] — max wall-clock ms per fetch (default 30000)
 * @param {(ms: number) => AbortSignal} [args.createSignal] — signal factory (injectable for tests)
 * @param {{ write: (s: string) => void }} [args.stderr]
 * @returns {Promise<{ opId: string; status: string; outcome: 'success' | 'failed' | 'deadline'; polls: number }>}
 */
async function pollOperation({
  projectId,
  apiKey,
  opId,
  deadlineMs,
  intervalMs,
  fetchImpl,
  nowMs,
  sleep,
  perRequestTimeoutMs,
  createSignal,
  stderr,
}) {
  const fetchFn = fetchImpl || fetch;
  const now = nowMs || Date.now;
  const sleepFn = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const err = stderr || process.stderr;
  const perReqMs =
    typeof perRequestTimeoutMs === 'number' && perRequestTimeoutMs > 0
      ? perRequestTimeoutMs
      : DEFAULT_PER_REQUEST_TIMEOUT_MS;
  const signalFactory = createSignal || createTimeoutSignal;

  let polls = 0;
  let status = 'unknown';
  while (true) {
    const currentNow = now();
    if (currentNow >= deadlineMs) {
      err.write(
        `::error::Deadline exceeded while polling operation ${opId} (last status: ${status}).\n`,
      );
      return { opId, status, outcome: 'deadline', polls };
    }
    // Per-request timeout: the smaller of the remaining overall deadline
    // and the configured per-request cap. This bounds a single hung HTTP
    // request so a stalled connection cannot hang indefinitely even when
    // the overall deadline is far away.
    const remaining = deadlineMs - currentNow;
    const reqTimeout = Math.min(remaining, perReqMs);
    const url = `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/operations/${encodeURIComponent(opId)}`;
    let response;
    try {
      response = await fetchFn(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: signalFactory(reqTimeout),
      });
    } catch (err_) {
      const isAbort = err_ && (err_.name === 'AbortError' || err_.name === 'TimeoutError');
      err.write(
        `::error::Fetch ${
          isAbort ? 'timed out' : 'threw'
        } while polling operation ${opId}: ${err_.message}. Retrying after interval.\n`,
      );
      polls += 1;
      await sleepFn(intervalMs);
      continue;
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '<no body>');
      err.write(
        `::error::Neon API GET /operations/${opId} returned ${response.status}: ${body}. Aborting.\n`,
      );
      return { opId, status: `http_${response.status}`, outcome: 'failed', polls };
    }
    const payload = await response.json().catch(() => ({}));
    status = extractOperationStatus(payload);
    polls += 1;
    err.write(`  operation ${opId} status: ${status}\n`);
    if (SUCCESS_STATES.has(status)) {
      return { opId, status, outcome: 'success', polls };
    }
    if (status === 'failed') {
      err.write(`::error::Operation ${opId} failed. Aborting.\n`);
      return { opId, status, outcome: 'failed', polls };
    }
    // Unknown / running / scheduling — keep polling up to the deadline.
    await sleepFn(intervalMs);
  }
}

/**
 * Main entry point. Reads the restore response from stdin, polls every
 * operation ID, and emits a JSON evidence document on stdout.
 * @param {Record<string, string | undefined>} env
 * @param {{ fetch?: typeof fetch; nowMs?: () => number; sleep?: (ms: number) => Promise<void>; createSignal?: (ms: number) => AbortSignal; stdin?: NodeJS.ReadStream; stdout?: NodeJS.WriteStream; stderr?: NodeJS.WriteStream }} [deps]
 * @returns {Promise<number>}
 */
async function main(env, deps) {
  const fetchImpl = deps?.fetch || fetch;
  const nowMs = deps?.nowMs || Date.now;
  const createSignal = deps?.createSignal;
  const sleepFn = deps?.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const stdin = deps?.stdin || process.stdin;
  const stdout = deps?.stdout || process.stdout;
  const stderr = deps?.stderr || process.stderr;

  const apiKey = env.NEON_API_KEY;
  const projectId = env.NEON_PROJECT_ID;
  if (!apiKey) throw new Error('NEON_API_KEY is required');
  if (!projectId) throw new Error('NEON_PROJECT_ID is required');
  const deadlineMinutes = Number(env.NEON_POLL_DEADLINE_MINUTES || DEFAULT_DEADLINE_MINUTES);
  if (!Number.isFinite(deadlineMinutes) || deadlineMinutes <= 0) {
    throw new Error(
      `NEON_POLL_DEADLINE_MINUTES must be a positive number (got "${env.NEON_POLL_DEADLINE_MINUTES}")`,
    );
  }
  const intervalSeconds = Number(env.NEON_POLL_INTERVAL_SECONDS || DEFAULT_INTERVAL_SECONDS);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    throw new Error(
      `NEON_POLL_INTERVAL_SECONDS must be a positive number (got "${env.NEON_POLL_INTERVAL_SECONDS}")`,
    );
  }
  const perRequestTimeoutMs = Number(
    env.NEON_POLL_PER_REQUEST_TIMEOUT_MS || DEFAULT_PER_REQUEST_TIMEOUT_MS,
  );
  if (!Number.isFinite(perRequestTimeoutMs) || perRequestTimeoutMs <= 0) {
    throw new Error(
      `NEON_POLL_PER_REQUEST_TIMEOUT_MS must be a positive number (got "${env.NEON_POLL_PER_REQUEST_TIMEOUT_MS}")`,
    );
  }

  // Read the restore response JSON from stdin.
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString(
    'utf8',
  );
  let payload;
  try {
    payload = raw.trim() ? JSON.parse(raw) : null;
  } catch (err_) {
    stderr.write(`::error::Stdin did not contain valid JSON: ${err_.message}\n`);
    const evidence = {
      checkedAt: new Date(nowMs()).toISOString(),
      projectId,
      ok: false,
      reason: `Stdin JSON parse error: ${err_.message}`,
      operationCount: 0,
      results: [],
    };
    stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    return 1;
  }

  const opIds = extractOperationIds(payload);
  if (opIds.length === 0) {
    stderr.write(
      '::error::Restore response contained no operation IDs. Aborting — do not connect to the restored branch.\n',
    );
    const evidence = {
      checkedAt: new Date(nowMs()).toISOString(),
      projectId,
      ok: false,
      reason: 'Restore response contained no operation IDs.',
      operationCount: 0,
      results: [],
    };
    stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    return 1;
  }

  const deadlineMs = nowMs() + deadlineMinutes * 60 * 1000;
  const results = [];
  let ok = true;
  for (const opId of opIds) {
    stderr.write(`Polling operation ${opId}...\n`);
    const result = await pollOperation({
      projectId,
      apiKey,
      opId,
      deadlineMs,
      intervalMs: intervalSeconds * 1000,
      perRequestTimeoutMs,
      createSignal,
      fetchImpl,
      nowMs,
      sleep: sleepFn,
      stderr,
    });
    results.push(result);
    if (result.outcome !== 'success') {
      ok = false;
      break;
    }
  }

  const evidence = {
    checkedAt: new Date(nowMs()).toISOString(),
    projectId,
    ok,
    deadlineMinutes,
    intervalSeconds,
    perRequestTimeoutMs,
    operationCount: opIds.length,
    results,
  };
  stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!ok) {
    stderr.write(
      `::error::One or more restore operations did not reach a successful terminal state. Do not connect to the restored branch.\n`,
    );
    return 1;
  }
  stderr.write(`All restore operations complete.\n`);
  return 0;
}

module.exports = {
  extractOperationIds,
  extractOperationStatus,
  pollOperation,
  createTimeoutSignal,
  main,
  DEFAULT_DEADLINE_MINUTES,
  DEFAULT_INTERVAL_SECONDS,
  DEFAULT_PER_REQUEST_TIMEOUT_MS,
  NEON_API_BASE,
};

if (require.main === module) {
  void main(process.env).then((code) => {
    process.exitCode = code;
  });
}
