#!/usr/bin/env node
/**
 * Create a named Neon recovery point immediately before a production migration.
 *
 * WHY THIS EXISTS: the PITR readiness gate (scripts/check-neon-pitr.js) requires
 * a restore point newer than PITR_MAX_AGE_HOURS (2h). That threshold was written
 * for the operator flow, where a human runs scripts/pitr-drill.sh and then
 * dispatches the deploy minutes later. Enabling PRODUCTION_AUTO_DEPLOY_ENABLED
 * inverts the trigger: GitHub decides when to deploy, nobody is present to
 * prepare a recovery point, and the gate fails on a stale snapshot for every
 * routine merge. The gate is not wrong — its assumption about who starts the
 * run is. This script restores that assumption by making the pipeline create
 * its own recovery point, so the guarantee holds unattended.
 *
 * It is deliberately NOT the drill. scripts/pitr-drill.sh proves the heavier
 * property — that a restore actually produces a serviceable database — and stays
 * an operator gate. This only creates the point a rollback would return to,
 * which is what migrate:apply needs in front of it.
 *
 * FREE-PLAN QUOTA: Neon's Free plan allows exactly ONE manual snapshot per
 * project, so creation fails with HTTP 422 until the previous one is removed.
 * With SNAPSHOT_REPLACE=true (the workflow default) the oldest snapshot for the
 * branch is deleted and creation retried once — the same trade pitr-drill.sh
 * documents for --replace-snapshot: the project keeps exactly one manual restore
 * point, always the most recent. Continuous PITR history is a separate mechanism
 * and is unaffected.
 *
 * Deleting is only attempted AFTER a creation failure, never pre-emptively, so
 * this is a no-op on a paid plan with slots free.
 *
 * Environment:
 *   NEON_API_KEY     (required) Neon API key.
 *   NEON_PROJECT_ID  (required) Neon project.
 *   NEON_BRANCH      Neon branch to snapshot (default: production — the NEON
 *                    branch name, not the Git branch `main`).
 *   SNAPSHOT_NAME    Recovery point name (default: pre-migration-<UTC stamp>).
 *   SNAPSHOT_REPLACE "true" to reclaim the quota slot on 422 (default: true).
 *
 * Exit codes: 0 — a recovery point exists. 1 — creation failed (the deploy must
 * not proceed: migrate:apply would run with nothing to roll back to).
 */

const NEON_API_BASE = 'https://console.neon.tech/api/v2';
const DEFAULT_BRANCH = 'production';

/**
 * Resolve a branch id from its name.
 * @param {string} projectId
 * @param {string} branchName
 * @param {string} apiKey
 * @param {typeof fetch} fetchFn
 * @returns {Promise<{id: string; name: string} | null>}
 */
async function resolveBranch(projectId, branchName, apiKey, fetchFn) {
  const url = `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/branches?search=${encodeURIComponent(branchName)}`;
  const response = await fetchFn(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
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
 * Create a snapshot. `name` is a QUERY parameter on this endpoint, not a body
 * field (https://api-docs.neon.tech/reference/createsnapshot).
 * @returns {Promise<{ok: boolean; status: number; body: string}>}
 */
async function createSnapshot(projectId, branchId, name, apiKey, fetchFn) {
  const url =
    `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/snapshot` +
    `?name=${encodeURIComponent(name)}`;
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  const body = await response.text().catch(() => '<no body>');
  return { ok: response.ok, status: response.status, body };
}

/**
 * List project snapshots. The endpoint is project-wide: it returns snapshots for
 * every root branch, so callers must filter by branch themselves.
 */
async function listSnapshots(projectId, apiKey, fetchFn) {
  const url = `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/snapshots`;
  const response = await fetchFn(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '<no body>');
    throw new Error(
      `Neon API GET /projects/${projectId}/snapshots returned ${response.status}: ${body}`,
    );
  }
  const payload = (await response.json()) || {};
  const snapshots = Array.isArray(payload.snapshots)
    ? payload.snapshots
    : Array.isArray(payload)
      ? payload
      : [];
  return snapshots.filter((s) => s && typeof s === 'object');
}

/**
 * Pick the snapshot whose slot should be reclaimed.
 *
 * Prefers the oldest snapshot on the TARGET branch, so the routine case reclaims
 * the previous deploy's own slot and touches nothing else. Falls back to the
 * oldest in the project — the quota is per-project, so a snapshot on another
 * branch can be the thing blocking creation — and flags that fallback so the
 * caller can say so out loud rather than silently deleting someone else's
 * restore point.
 *
 * @returns {{id: string; created_at?: string; name?: string; foreign: boolean} | null}
 */
function pickSnapshotToEvict(snapshots, branchId) {
  const byAge = (a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''));
  const onBranch = snapshots
    .filter((s) => (s.branch_id || s.source_branch_id) === branchId)
    .sort(byAge);
  if (onBranch.length > 0) return { ...onBranch[0], foreign: false };
  const anywhere = [...snapshots].sort(byAge);
  if (anywhere.length > 0) return { ...anywhere[0], foreign: true };
  return null;
}

async function deleteSnapshot(projectId, snapshotId, apiKey, fetchFn) {
  const url = `${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/snapshots/${encodeURIComponent(snapshotId)}`;
  const response = await fetchFn(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '<no body>');
    throw new Error(`Neon API DELETE snapshot ${snapshotId} returned ${response.status}: ${body}`);
  }
}

/** Default recovery point name: pre-migration-<UTC stamp>, matching pitr-drill.sh. */
function defaultSnapshotName(now) {
  const iso = now.toISOString();
  return `pre-migration-${iso.slice(0, 19).replace(/[-:T]/g, '')}`;
}

async function main(env, deps) {
  const fetchImpl = deps?.fetch || fetch;
  const now = deps?.now || (() => new Date());
  const stdout = deps?.stdout || process.stdout;
  const stderr = deps?.stderr || process.stderr;

  const apiKey = env.NEON_API_KEY;
  const projectId = env.NEON_PROJECT_ID;
  if (!apiKey) throw new Error('NEON_API_KEY is required');
  if (!projectId) throw new Error('NEON_PROJECT_ID is required');

  const branchName = env.NEON_BRANCH || DEFAULT_BRANCH;
  const snapshotName = env.SNAPSHOT_NAME || defaultSnapshotName(now());
  // Defaults ON: the free plan is the only configuration this project runs, and
  // there a quota failure is the expected first response, not an anomaly.
  const replace = (env.SNAPSHOT_REPLACE || 'true') === 'true';

  const branch = await resolveBranch(projectId, branchName, apiKey, fetchImpl);
  if (!branch) {
    stderr.write(
      `::error::Neon branch "${branchName}" not found in project ${projectId}. Cannot create a recovery point.\n`,
    );
    return 1;
  }

  const evidence = {
    projectId,
    branch: { name: branch.name, id: branch.id },
    snapshotName,
    replaceRequested: replace,
    evicted: null,
    created: false,
  };

  let attempt = await createSnapshot(projectId, branch.id, snapshotName, apiKey, fetchImpl);

  if (!attempt.ok && replace) {
    // Quota recovery. Only a full-quota response is worth evicting for; a 401 or
    // a 404 is not fixed by deleting a restore point, and deleting one to find
    // that out would be destructive for no reason.
    const quotaExhausted = attempt.status === 422 || attempt.status === 409;
    if (quotaExhausted) {
      const snapshots = await listSnapshots(projectId, apiKey, fetchImpl);
      const victim = pickSnapshotToEvict(snapshots, branch.id);
      if (victim) {
        if (victim.foreign) {
          stderr.write(
            `::warning::Quota is full and no snapshot exists for branch "${branchName}"; ` +
              `evicting the oldest snapshot in the PROJECT instead (${victim.id}, created ${victim.created_at}).\n`,
          );
        }
        await deleteSnapshot(projectId, victim.id, apiKey, fetchImpl);
        evidence.evicted = {
          id: victim.id,
          name: victim.name || null,
          createdAt: victim.created_at || null,
          foreign: victim.foreign,
        };
        attempt = await createSnapshot(projectId, branch.id, snapshotName, apiKey, fetchImpl);
      }
    }
  }

  evidence.created = attempt.ok;
  evidence.status = attempt.status;
  stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);

  if (!attempt.ok) {
    stderr.write(
      `::error::Could not create a Neon recovery point for branch "${branchName}" ` +
        `(HTTP ${attempt.status}): ${attempt.body}\n`,
    );
    return 1;
  }

  stderr.write(
    `[OK] Recovery point "${snapshotName}" created for branch "${branchName}"` +
      `${evidence.evicted ? ` (reclaimed the slot held by ${evidence.evicted.id})` : ''}.\n`,
  );
  return 0;
}

module.exports = {
  resolveBranch,
  createSnapshot,
  listSnapshots,
  pickSnapshotToEvict,
  deleteSnapshot,
  defaultSnapshotName,
  main,
  DEFAULT_BRANCH,
  NEON_API_BASE,
};

if (require.main === module) {
  void main(process.env)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        `::error::Recovery point creation could not run: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
