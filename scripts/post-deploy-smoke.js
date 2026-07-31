#!/usr/bin/env node
/**
 * Phase 1 task 1.7 — post-deploy smoke test.
 *
 * Hits a configurable list of endpoints against a deployed Worker URL and
 * verifies each returns a 2xx response within a latency budget. Used by the
 * canary job in the deploy workflow: once immediately after deploy, and again
 * after a wait window. A failure exits non-zero so the canary gate fails.
 *
 * Usage:
 *   node scripts/post-deploy-smoke.js
 *
 * Environment variables:
 *   SMOKE_TARGET_URL       — base URL of the deployed Worker (required)
 *   SMOKE_ENDPOINTS        — optional comma-separated list of paths (defaults below)
 *   SMOKE_LATENCY_MS       — optional per-endpoint latency budget in ms (default 5000)
 *   SMOKE_TIMEOUT_MS       — optional per-request timeout in ms (default 10000)
 *   SMOKE_EXPECT_DB_READY  — "true" requires /health?deep=true to report a healthy DB
 *   SMOKE_AUTH_TOKEN       — optional Bearer token sent as Authorization header.
 *                             Required for authenticated endpoints like
 *                             /api/subscription/current, which calls
 *                             authenticateApiRequest and returns 401 without a
 *                             valid token. Without this, the canary would either
 *                             fail spuriously on 401 or — if 401 were treated as
 *                             success — stop exercising the schema-dependent query.
 *   CANARY_WAF_SECRET      — optional shared secret sent as a header so a
 *                             Cloudflare "Skip" rule lets CI probes through the
 *                             edge bot protection that 403s datacenter IPs.
 *                             Omitted when unset (local/residential runs are
 *                             unaffected). Must match the value in the CF rule.
 *   CANARY_WAF_HEADER      — optional header name for the above (default
 *                             "x-canary-secret"); must match the CF rule field.
 *
 * Exit codes:
 *   0 — all endpoints passed
 *   1 — one or more endpoints failed
 *
 * Output: a JSON evidence document on stdout suitable for CI artifact upload.
 */
const DEFAULT_ENDPOINTS = ['/health?deep=true', '/api/subscription/current'];
const DEFAULT_LATENCY_MS = 5000;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Default endpoint expectations. An endpoint may declare:
 *   - status: 2xx (default) or an exact code
 *   - requireDbReady: only meaningful for /health?deep=true; requires
 *     checks.database.status === 'pass' in the JSON body
 */
const ENDPOINT_EXPECTATIONS = {
  '/health?deep=true': { requireDbReady: true },
};

/**
 * Probe a single endpoint.
 * @param {string} baseUrl
 * @param {string} path
 * @param {{ timeoutMs: number; fetchImpl?: typeof fetch; authToken?: string }} opts
 * @returns {Promise<{ path: string; status: number | null; ok: boolean; latencyMs: number; error?: string; body?: unknown }>}
 */
async function probeEndpoint(baseUrl, path, opts) {
  const fetchFn = opts.fetchImpl || fetch;
  const url = baseUrl.replace(/\/$/, '') + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const start = Date.now();
  try {
    const headers = { Accept: 'application/json' };
    if (opts.authToken) {
      headers.Authorization = `Bearer ${opts.authToken}`;
    }
    // Optional Cloudflare WAF bypass: CI runners probe from datacenter IPs that
    // Cloudflare's bot protection 403s at the edge before the request reaches
    // the Worker. When a shared secret is configured, send it as a header that a
    // Cloudflare "Skip" rule matches so the canary (and only the canary) is let
    // through. Omitted when unset, so residential/local runs are unaffected.
    if (opts.wafBypassSecret) {
      headers[opts.wafBypassHeader] = opts.wafBypassSecret;
    }
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers,
    });
    const latencyMs = Date.now() - start;
    let body;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await response.json().catch(() => undefined);
    }
    return { path, status: response.status, ok: response.ok, latencyMs, body };
  } catch (error) {
    const latencyMs = Date.now() - start;
    return {
      path,
      status: null,
      ok: false,
      latencyMs,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Evaluate a probe result against expectations.
 * @param {{ path: string; status: number | null; ok: boolean; latencyMs: number; error?: string; body?: unknown }} result
 * @param {number} latencyBudgetMs
 * @returns {{ passed: boolean; failures: string[] }}
 */
function evaluateProbe(result, latencyBudgetMs) {
  const failures = [];
  if (result.status === null) {
    failures.push(`request failed: ${result.error || 'unknown error'}`);
  } else if (!result.ok) {
    failures.push(`non-2xx status: ${result.status}`);
  }
  if (result.latencyMs > latencyBudgetMs) {
    failures.push(`latency ${result.latencyMs}ms exceeds budget ${latencyBudgetMs}ms`);
  }
  const expectation = ENDPOINT_EXPECTATIONS[result.path];
  if (expectation?.requireDbReady) {
    const dbCheck = result.body?.checks?.database;
    if (!dbCheck || dbCheck.status !== 'pass') {
      failures.push(
        `database readiness check did not pass: ${JSON.stringify(dbCheck || 'missing')}`,
      );
    }
  }
  return { passed: failures.length === 0, failures };
}

/**
 * Main entry point. Returns the evidence document; exits non-zero on failure.
 * @param {Record<string, string | undefined>} env
 * @param {{ fetch?: typeof fetch; stdout?: { write: (s: string) => void }; stderr?: { write: (s: string) => void } }} [deps]
 * @returns {Promise<number>}
 */
async function main(env, deps) {
  const fetchImpl = deps?.fetch || fetch;
  const stdout = deps?.stdout || process.stdout;
  const stderr = deps?.stderr || process.stderr;

  const baseUrl = env.SMOKE_TARGET_URL;
  if (!baseUrl) throw new Error('SMOKE_TARGET_URL is required');
  const endpoints = (env.SMOKE_ENDPOINTS || DEFAULT_ENDPOINTS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (endpoints.length === 0) throw new Error('SMOKE_ENDPOINTS resolved to an empty list');
  const latencyBudgetMs = Number(env.SMOKE_LATENCY_MS || DEFAULT_LATENCY_MS);
  const timeoutMs = Number(env.SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const authToken = env.SMOKE_AUTH_TOKEN || '';
  // Cloudflare WAF bypass header for CI (see probeEndpoint). Header name is
  // configurable but defaults to the value the Cloudflare Skip rule matches.
  const wafBypassSecret = env.CANARY_WAF_SECRET || '';
  const wafBypassHeader = (env.CANARY_WAF_HEADER || 'x-canary-secret').toLowerCase();

  const results = [];
  for (const path of endpoints) {
    const result = await probeEndpoint(baseUrl, path, {
      timeoutMs,
      fetchImpl,
      authToken: authToken || undefined,
      wafBypassSecret: wafBypassSecret || undefined,
      wafBypassHeader,
    });
    const evaluation = evaluateProbe(result, latencyBudgetMs);
    results.push({
      path,
      status: result.status,
      ok: result.ok,
      latencyMs: result.latencyMs,
      error: result.error,
      passed: evaluation.passed,
      failures: evaluation.failures,
    });
    if (!evaluation.passed) {
      stderr.write(`::error::Smoke test failed for ${path}: ${evaluation.failures.join('; ')}\n`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const evidence = {
    checkedAt: new Date().toISOString(),
    targetUrl: baseUrl,
    latencyBudgetMs,
    timeoutMs,
    authenticated: authToken !== '',
    summary: { total: results.length, passed, failed },
    results,
  };

  stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  return failed === 0 ? 0 : 1;
}

module.exports = {
  probeEndpoint,
  evaluateProbe,
  main,
  DEFAULT_ENDPOINTS,
  DEFAULT_LATENCY_MS,
  DEFAULT_TIMEOUT_MS,
  ENDPOINT_EXPECTATIONS,
};

if (require.main === module) {
  void main(process.env).then((code) => {
    process.exitCode = code;
  });
}
