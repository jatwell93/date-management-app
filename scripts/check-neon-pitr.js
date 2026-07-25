#!/usr/bin/env node
/**
 * Phase 1 task 1.7 — Neon PITR readiness check.
 *
 * Verifies that a Neon restore point (snapshot) exists within the last N hours
 * before applying a production migration. This is the CI-side half of the PITR
 * readiness gate; the operator runbook documents the full restore-to-new-branch
 * drill as a separate, heavier operator gate.
 *
 * Usage:
 *   node scripts/check-neon-pitr.js
 *
 * Environment variables:
 *   NEON_API_KEY     — Neon API key (read-only is sufficient)
 *   NEON_PROJECT_ID  — the Neon project ID to check (e.g. dawn-darkness-22587117)
 *   NEON_BRANCH      — optional branch name to filter by (defaults to "main")
 *   PITR_MAX_AGE_HOURS — max acceptable age of the newest restore point (default 2)
 *
 * Exit codes:
 *   0 — a restore point within the threshold exists (PITR ready)
 *   1 — no restore point within the threshold, or API error
 *
 * Output: a JSON evidence document on stdout suitable for CI artifact upload.
 */

const NEON_API_BASE = 'https://console.neon.tech/api/v2';
const DEFAULT_MAX_AGE_HOURS = 2;
const DEFAULT_BRANCH = 'main';

/**
 * Fetch the list of project snapshots from the Neon API.
 * @param {string} projectId
 * @param {string} apiKey
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<unknown>}
 */
async function fetchProjectSnapshots(projectId, apiKey, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const url = `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/snapshots`;
  const response = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '<no body>');
    throw new Error(
      `Neon API GET /projects/${projectId}/snapshots returned ${response.status}: ${body}`,
    );
  }
  return response.json();
}

/**
 * Fetch the list of branches to resolve the branch ID for the named branch.
 * @param {string} projectId
 * @param {string} branchName
 * @param {string} apiKey
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{id: string; name: string} | null>}
 */
async function resolveBranch(projectId, branchName, apiKey, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const url = `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/branches?search=${encodeURIComponent(branchName)}`;
  const response = await fetchFn(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '<no body>');
    throw new Error(
      `Neon API GET /projects/${projectId}/branches returned ${response.status}: ${body}`,
    );
  }
  const payload = (await response.json()) || {};
  const branches = Array.isArray(payload.branches) ? payload.branches : [];
  const match = branches.find(
    (b) => b && typeof b === 'object' && b.name === branchName && !b.deleted,
  );
  return match ? { id: match.id, name: match.name } : null;
}

/**
 * Extract snapshot timestamps from the Neon API response.
 *
 * The Neon snapshots endpoint returns either `{ snapshots: [...] }` or a bare
 * array. Each snapshot has a `created_at` ISO 8601 timestamp. We extract
 * timestamps defensively so a shape change does not crash the gate silently.
 * @param {unknown} payload
 * @returns {Array<{ id: string; createdAt: Date; branchId?: string }>}
 */
function extractSnapshots(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray(payload.snapshots)
      ? payload.snapshots
      : [];
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry.created_at || entry.createdAt;
    if (typeof raw !== 'string') continue;
    const createdAt = new Date(raw);
    if (Number.isNaN(createdAt.getTime())) continue;
    out.push({
      id: typeof entry.id === 'string' ? entry.id : '<unknown>',
      createdAt,
      branchId: typeof entry.branch_id === 'string' ? entry.branch_id : undefined,
    });
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Evaluate PITR readiness against the newest snapshot.
 * @param {Array<{ createdAt: Date; id: string; branchId?: string }>} snapshots
 * @param {number} maxAgeHours
 * @param {Date} now
 * @returns {{ ready: boolean; newestAgeHours: number | null; newest: { id: string; createdAt: string } | null }}
 */
function evaluatePitrReadiness(snapshots, maxAgeHours, now) {
  if (snapshots.length === 0) {
    return { ready: false, newestAgeHours: null, newest: null };
  }
  const newest = snapshots[0];
  const ageMs = now.getTime() - newest.createdAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  return {
    ready: ageHours <= maxAgeHours,
    newestAgeHours: Math.round(ageHours * 100) / 100,
    newest: { id: newest.id, createdAt: newest.createdAt.toISOString() },
  };
}

/**
 * Main entry point. Returns the evidence document; exits non-zero on failure.
 * @param {Record<string, string | undefined>} env
 * @param {{ fetch?: typeof fetch; now?: () => Date; stdout?: NodeJS.WriteStream; stderr?: NodeJS.WriteStream }} [deps]
 */
async function main(env, deps) {
  const fetchImpl = deps?.fetch || fetch;
  const now = deps?.now || (() => new Date());
  const stdout = deps?.stdout || process.stdout;
  const stderr = deps?.stderr || process.stderr;

  const apiKey = env.NEON_API_KEY;
  const projectId = env.NEON_PROJECT_ID;
  if (!apiKey) throw new Error('NEON_API_KEY is required');
  if (!projectId) throw new Error('NEON_PROJECT_ID is required');
  const maxAgeHours = Number(env.PITR_MAX_AGE_HOURS || DEFAULT_MAX_AGE_HOURS);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error(
      `PITR_MAX_AGE_HOURS must be a positive number (got "${env.PITR_MAX_AGE_HOURS}")`,
    );
  }
  const branchName = env.NEON_BRANCH || DEFAULT_BRANCH;

  const snapshots = extractSnapshots(await fetchProjectSnapshots(projectId, apiKey, fetchImpl));
  const verdict = evaluatePitrReadiness(snapshots, maxAgeHours, now());

  // Resolve the branch ID for evidence (best-effort; does not gate the verdict).
  let branch = null;
  try {
    branch = await resolveBranch(projectId, branchName, apiKey, fetchImpl);
  } catch (error) {
    stderr.write(
      `[WARN] Could not resolve branch "${branchName}" for evidence: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  const evidence = {
    checkedAt: now().toISOString(),
    projectId,
    branch: { name: branchName, id: branch?.id || null },
    maxAgeHours,
    snapshotCount: snapshots.length,
    newestSnapshot: verdict.newest,
    newestAgeHours: verdict.newestAgeHours,
    ready: verdict.ready,
    thresholds: {
      maxAgeHours,
      description: `A restore point must exist within the last ${maxAgeHours} hour(s)`,
    },
  };

  stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!verdict.ready) {
    if (snapshots.length === 0) {
      stderr.write(
        `::error::No Neon restore points found for project ${projectId}. PITR readiness gate failed.\n`,
      );
    } else {
      stderr.write(
        `::error::Newest Neon restore point is ${verdict.newestAgeHours}h old (threshold ${maxAgeHours}h). PITR readiness gate failed.\n`,
      );
    }
    return 1;
  }
  stderr.write(
    `[OK] PITR ready: newest restore point is ${verdict.newestAgeHours}h old (threshold ${maxAgeHours}h).\n`,
  );
  return 0;
}

module.exports = {
  fetchProjectSnapshots,
  resolveBranch,
  extractSnapshots,
  evaluatePitrReadiness,
  main,
  DEFAULT_MAX_AGE_HOURS,
  DEFAULT_BRANCH,
  NEON_API_BASE,
};

if (require.main === module) {
  void main(process.env).then((code) => {
    process.exitCode = code;
  });
}
