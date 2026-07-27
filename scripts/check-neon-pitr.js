#!/usr/bin/env node
/**
 * Phase 1 task 1.7 — Neon PITR readiness check.
 *
 * Verifies that a Neon restore point (snapshot) exists within the last N hours
 * for the TARGET BRANCH before applying a production migration. This is the
 * CI-side half of the PITR readiness gate; the operator runbook documents the
 * full restore-to-new-branch drill as a separate, heavier operator gate.
 *
 * Branch scoping: Neon's project-wide snapshots endpoint returns snapshots for
 * every root branch in the project. A recent snapshot from a development branch
 * must NOT satisfy the gate for the production branch. This script:
 *   1. Resolves the target branch by name (fail closed if not found).
 *   2. Fetches all project snapshots.
 *   3. Filters snapshots to only those whose branch_id matches the resolved
 *      branch. Snapshots without a branch_id are excluded (we cannot prove
 *      they belong to the target branch).
 *   4. Evaluates only the filtered collection.
 *   5. Rejects implausible future timestamps (negative age) rather than
 *      treating them as "recent".
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
 *   0 — a restore point within the threshold exists for the target branch (PITR ready)
 *   1 — no restore point within the threshold, branch not found, or API error
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
 * array. Each snapshot has a `created_at` ISO 8601 timestamp and a `branch_id`
 * identifying the root branch it originated from. We extract timestamps
 * defensively so a shape change does not crash the gate silently.
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
 * Filter snapshots to only those belonging to the resolved branch.
 * Snapshots without a branch_id are excluded — we cannot prove they belong
 * to the target branch, so including them would risk a stale production
 * snapshot being masked by an unattributable one.
 * @param {Array<{ id: string; createdAt: Date; branchId?: string }>} snapshots
 * @param {string} branchId
 * @returns {Array<{ id: string; createdAt: Date; branchId?: string }>}
 */
function filterSnapshotsByBranch(snapshots, branchId) {
  return snapshots.filter((s) => s.branchId === branchId);
}

/**
 * Evaluate PITR readiness against the newest snapshot for the target branch.
 *
 * Future timestamps (negative age) are treated as NOT ready — an implausible
 * future restore point indicates clock skew or API corruption, not a valid
 * restore point. We fail closed rather than treating negative age as "recent".
 * @param {Array<{ createdAt: Date; id: string; branchId?: string }>} snapshots
 * @param {number} maxAgeHours
 * @param {Date} now
 * @returns {{ ready: boolean; newestAgeHours: number | null; newest: { id: string; createdAt: string } | null; reason?: string }}
 */
function evaluatePitrReadiness(snapshots, maxAgeHours, now) {
  if (snapshots.length === 0) {
    return { ready: false, newestAgeHours: null, newest: null };
  }
  const newest = snapshots[0];
  const ageMs = now.getTime() - newest.createdAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  // Reject implausible future timestamps (negative age). Clock skew or a
  // corrupted API response should not satisfy the gate.
  if (ageHours < 0) {
    return {
      ready: false,
      newestAgeHours: Math.round(ageHours * 100) / 100,
      newest: { id: newest.id, createdAt: newest.createdAt.toISOString() },
      reason: `Newest restore point timestamp is in the future (${newest.createdAt.toISOString()} vs now ${now.toISOString()}); rejecting as implausible.`,
    };
  }
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
 * @returns {Promise<number>}
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

  // Step 1: Resolve the target branch FIRST. Fail closed if it cannot be
  // resolved — we must not evaluate snapshots without confirming they belong
  // to the target branch.
  const branch = await resolveBranch(projectId, branchName, apiKey, fetchImpl);
  if (!branch) {
    stderr.write(
      `::error::Could not resolve Neon branch "${branchName}" in project ${projectId}. PITR readiness gate failed (fail closed).\n`,
    );
    const evidence = {
      checkedAt: now().toISOString(),
      projectId,
      branch: { name: branchName, id: null },
      maxAgeHours,
      snapshotCount: 0,
      branchSnapshotCount: 0,
      newestSnapshot: null,
      newestAgeHours: null,
      ready: false,
      reason: `Branch "${branchName}" could not be resolved in project ${projectId}.`,
      thresholds: {
        maxAgeHours,
        description: `A restore point must exist within the last ${maxAgeHours} hour(s) for branch "${branchName}"`,
      },
    };
    stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    return 1;
  }

  // Step 2: Fetch all project snapshots (Neon's endpoint is project-wide).
  const allSnapshots = extractSnapshots(await fetchProjectSnapshots(projectId, apiKey, fetchImpl));

  // Step 3: Filter to only snapshots belonging to the resolved branch.
  const branchSnapshots = filterSnapshotsByBranch(allSnapshots, branch.id);

  // Step 4: Evaluate only the filtered collection.
  const verdict = evaluatePitrReadiness(branchSnapshots, maxAgeHours, now());

  const evidence = {
    checkedAt: now().toISOString(),
    projectId,
    branch: { name: branchName, id: branch.id },
    maxAgeHours,
    snapshotCount: allSnapshots.length,
    branchSnapshotCount: branchSnapshots.length,
    newestSnapshot: verdict.newest,
    newestAgeHours: verdict.newestAgeHours,
    ready: verdict.ready,
    reason: verdict.reason || null,
    thresholds: {
      maxAgeHours,
      description: `A restore point must exist within the last ${maxAgeHours} hour(s) for branch "${branchName}" (id: ${branch.id})`,
    },
  };

  stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  if (!verdict.ready) {
    if (branchSnapshots.length === 0) {
      stderr.write(
        `::error::No Neon restore points found for branch "${branchName}" (id: ${branch.id}) in project ${projectId}. PITR readiness gate failed.\n`,
      );
    } else if (verdict.reason) {
      stderr.write(`::error::${verdict.reason} PITR readiness gate failed.\n`);
    } else {
      stderr.write(
        `::error::Newest Neon restore point for branch "${branchName}" is ${verdict.newestAgeHours}h old (threshold ${maxAgeHours}h). PITR readiness gate failed.\n`,
      );
    }
    return 1;
  }
  stderr.write(
    `[OK] PITR ready: newest restore point for branch "${branchName}" is ${verdict.newestAgeHours}h old (threshold ${maxAgeHours}h).\n`,
  );
  return 0;
}

module.exports = {
  fetchProjectSnapshots,
  resolveBranch,
  extractSnapshots,
  filterSnapshotsByBranch,
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
