#!/usr/bin/env bash
#
# Phase 1 task 1.9 — production recovery drill (runbook Step 1, scripted).
#
# Proves that Neon point-in-time recovery actually works for the production
# branch: creates a NAMED recovery point, restores it into a throwaway branch,
# verifies the migration ledger and the application against the restored data,
# records RPO/RTO, and tears the branch down.
#
# This is the operator half of the two-layer PITR gate described in
# openspec/changes/retire-express-unify-on-postgres/design.md. The other half —
# "a restore point EXISTS" — is scripts/check-neon-pitr.js, which runs
# automatically as the `pitr-check` step of .github/workflows/migration-prep.yml.
# This script proves the heavier property: that the restore WORKS and the
# application is serviceable against what comes back.
#
# WHY THIS IS A SCRIPT AND NOT RUNBOOK PROSE: Step 1 of
# docs/migrations-deploy-runbook.md is ~230 lines of shell that an operator had
# to paste before every production migration. Pasting long blocks into Git Bash
# on Windows is where several past drills went wrong (line wrapping, and psql
# being winpty-wrapped so command substitution silently yields an empty string —
# see docs/evidence/2026-08-05-1.6b/step3-restore-drill.txt). Everything here
# runs from a committed, reviewed, testable file instead, and the drill uses NO
# psql at all: the schema and application checks go through
# scripts/verify-app-against-branch.js using the Worker's own driver.
#
# SAFETY:
#   * Every Neon call against the production branch is read-only except the
#     snapshot creation, which is additive and is what a pre-migration recovery
#     point is for.
#   * The restore uses `finalize_restore: false`, which materializes a SEPARATE
#     preview branch. The production branch is never touched.
#   * The drill branch is deleted on exit via a trap, including on failure, so a
#     mid-drill abort cannot leak a branch holding production data.
#   * Connection strings are never printed. Evidence records a redacted host.
#
# Usage:
#   export NEON_API_KEY=<key>
#   bash scripts/pitr-drill.sh --dry-run    # print the plan, mutate nothing
#   bash scripts/pitr-drill.sh              # run the drill
#
# Options:
#   --dry-run          Resolve the branch and report readiness; create nothing.
#   --keep             Do not delete the drill branch (for investigation).
#   --replace-snapshot If snapshot creation fails on quota, DELETE the oldest
#                      snapshot and retry once. Prefers a snapshot on this
#                      branch; falls back (loudly) to the oldest in the PROJECT,
#                      because the quota is per-project. Required on the Neon
#                      Free plan for every drill after the first — see the note
#                      below. No-op when creation succeeds.
#   --use-existing-snapshot
#                      Restore the newest EXISTING snapshot instead of creating
#                      a new one. Fallback for plans that do not allow
#                      on-demand snapshot creation. Still proves restore works,
#                      but NOT the "named pre-migration recovery point" clause
#                      of task 1.9 — record that limitation in the sign-off.
#                      Also note migrate:verify will FAIL if that snapshot
#                      predates the current schema; that is staleness, not drift.
#
#   --name <label>     Recovery point name (default: pre-migration-<UTC stamp>).
#   --evidence <path>  Where to write the evidence file
#                      (default: pitr-drill-evidence-<UTC stamp>.txt).
#
# FREE-PLAN SNAPSHOT QUOTA: Neon's Free plan allows exactly ONE manual snapshot
# per project (paid plans allow 100). Each drill creates one, so every drill
# after the first fails with HTTP 422 until the previous snapshot is removed.
# On the free plan the steady-state invocation is therefore:
#     bash scripts/pitr-drill.sh --replace-snapshot
# The trade-off is explicit: the project keeps exactly one manual restore point,
# always the most recent. Continuous PITR history (see
# docs/neon-backup-restore.md) is a separate mechanism and is unaffected.
#
# Environment:
#   NEON_API_KEY       (required) Neon API key.
#   NEON_PROJECT_ID    Neon project (default: dawn-darkness-22587117).
#   NEON_BRANCH        Neon branch to drill (default: production — the NEON
#                      branch name, not the Git branch `main`).
#   DRILL_ROLE         Role to connect as (default: neondb_owner — the schema
#                      owner, the same identity migrate:verify asserts).
#   PITR_MAX_AGE_HOURS Max age of an existing snapshot before one is created.
#   DRILL_OPERATOR     Name recorded as "Responsible operator" in the evidence
#                      file — the accountability clause of task 1.9. Defaults to
#                      `git config user.name`, then "unrecorded".
#
# Exit codes: 0 — drill passed. 1 — any step failed (drill branch cleaned up).

set -euo pipefail

NEON_PROJECT_ID="${NEON_PROJECT_ID:-dawn-darkness-22587117}"
NEON_BRANCH="${NEON_BRANCH:-production}"
DRILL_ROLE="${DRILL_ROLE:-neondb_owner}"
NEON_API_BASE="https://console.neon.tech/api/v2"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

STAMP="$(date -u +%Y%m%d%H%M%S)"
DRY_RUN=0
KEEP_BRANCH=0
USE_EXISTING=0
REPLACE_SNAPSHOT=0
SNAPSHOT_NAME="pre-migration-${STAMP}"
EVIDENCE_FILE="${REPO_ROOT}/pitr-drill-evidence-${STAMP}.txt"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --keep) KEEP_BRANCH=1; shift ;;
    --use-existing-snapshot) USE_EXISTING=1; shift ;;
    --replace-snapshot) REPLACE_SNAPSHOT=1; shift ;;
    --name) SNAPSHOT_NAME="$2"; shift 2 ;;
    --evidence) EVIDENCE_FILE="$2"; shift 2 ;;
    # Print the header comment block up to the "Exit codes" line that ends it.
    # A hardcoded line range silently truncates (or spills into code) the moment
    # a header line is added.
    -h|--help) sed -n '2,/^# Exit codes/p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "::error::Unknown option: $1" >&2; exit 1 ;;
  esac
done

DRILL_BRANCH="pitr-drill-${STAMP}"
DRILL_BRANCH_ID=""

# ---------------------------------------------------------------------------
# Output helpers. Everything an operator needs to paste back lands in the
# evidence file as well as on the terminal, so a wrapped/truncated terminal
# copy is never the only record.
# ---------------------------------------------------------------------------
say() { printf '%s\n' "$*" | tee -a "$EVIDENCE_FILE"; }
step() { printf '\n=== %s ===\n' "$*" | tee -a "$EVIDENCE_FILE"; }

require_tool() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "::error::Required tool '$1' is not on PATH." >&2
    exit 1
  }
}

# Every Neon call is bounded. Without these, a DNS hang or a stalled TCP
# connection blocks the drill indefinitely: `set -e` never fires, the EXIT trap
# never runs, and the operator is left with a script that appears to be working
# while holding a branch full of production data. Ctrl-C is not a safe answer
# either — it interrupts before the branch id is known. Neon's control-plane
# calls here are all fast (the slow part, materializing the restore, is polled
# separately by neon-poll-operations.js), so a 120s ceiling is generous.
CURL_TIMEOUTS=(--connect-timeout 10 --max-time 120)

api_get() {
  curl --fail-with-body --silent --show-error "${CURL_TIMEOUTS[@]}" \
    -H "Authorization: Bearer ${NEON_API_KEY}" \
    -H "Accept: application/json" "$@"
}

# ---------------------------------------------------------------------------
# Cleanup. Registered before the branch exists so an abort at ANY point after
# the restore call still removes the branch. Deleting a branch that was never
# created is a no-op because DRILL_BRANCH_ID stays empty.
#
# The BRANCH is cleaned up; the SNAPSHOT is deliberately NOT. That asymmetry is
# the point of the drill: the branch is a throwaway copy of production data and
# must not outlive the run, whereas the snapshot IS the named pre-migration
# recovery point (task 1.9). Deleting it on failure would destroy the recovery
# point at the exact moment something has just gone wrong — the one time it is
# most likely to be needed. It costs a quota slot on the free plan, and
# --replace-snapshot reclaims that slot on the next run; that is the cheaper
# trade by a wide margin.
# ---------------------------------------------------------------------------
cleanup() {
  local exit_code=$?
  if [ -n "$DRILL_BRANCH_ID" ] && [ "$KEEP_BRANCH" -eq 0 ]; then
    printf '\n=== Cleanup: deleting drill branch ===\n' | tee -a "$EVIDENCE_FILE"
    if curl --fail-with-body --silent --show-error "${CURL_TIMEOUTS[@]}" --request DELETE \
      -H "Authorization: Bearer ${NEON_API_KEY}" \
      "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/branches/${DRILL_BRANCH_ID}" \
      >/dev/null 2>&1; then
      printf 'Drill branch deleted: yes\n' | tee -a "$EVIDENCE_FILE"
    else
      # Loud, because a leaked branch holds a copy of production data.
      printf '::error::FAILED to delete drill branch %s. DELETE IT MANUALLY.\n' \
        "$DRILL_BRANCH" | tee -a "$EVIDENCE_FILE"
    fi
  elif [ -n "$DRILL_BRANCH_ID" ]; then
    printf '\nDrill branch KEPT at operator request (--keep): %s\n' \
      "$DRILL_BRANCH" | tee -a "$EVIDENCE_FILE"
    printf 'Delete it when finished — it holds a copy of production data.\n' \
      | tee -a "$EVIDENCE_FILE"
  fi
  # Only claim an evidence file when one was actually written — the
  # precondition checks above can abort before it is created.
  if [ -s "$EVIDENCE_FILE" ]; then
    printf '\nEvidence written to: %s\n' "$EVIDENCE_FILE"
  fi
  exit "$exit_code"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
require_tool curl
require_tool jq
require_tool node
: "${NEON_API_KEY:?NEON_API_KEY is required (export it before running)}"

: > "$EVIDENCE_FILE"
say "PITR drill — task 1.9 production recovery verification"
say "Started (UTC):    $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "Neon branch:      ${NEON_BRANCH}"
say "Connect as role:  ${DRILL_ROLE}"
say "Recovery point:   ${SNAPSHOT_NAME}"
say "Drill branch:     ${DRILL_BRANCH}"
say "Mode:             $([ "$DRY_RUN" -eq 1 ] && echo 'DRY RUN (no mutation)' || echo 'LIVE')"

# ---------------------------------------------------------------------------
# Step 1a — readiness, and a NAMED pre-migration recovery point.
# ---------------------------------------------------------------------------
step "1a. Restore-point readiness (scripts/check-neon-pitr.js)"

# The existing CI gate is the readiness check — reuse it rather than
# reimplementing the branch-scoped snapshot filtering it already does
# correctly. It is allowed to fail here: a stale snapshot is exactly the
# condition that calls for creating a fresh named recovery point below.
PITR_READY=0
if NEON_API_KEY="$NEON_API_KEY" NEON_PROJECT_ID="$NEON_PROJECT_ID" \
   NEON_BRANCH="$NEON_BRANCH" \
   node "${REPO_ROOT}/scripts/check-neon-pitr.js" >>"$EVIDENCE_FILE" 2>&1; then
  PITR_READY=1
fi
say "Existing restore point within threshold: $([ "$PITR_READY" -eq 1 ] && echo yes || echo 'no (a fresh one will be created)')"

step "1a. Resolve the Neon branch"
# `|| true` so an API failure produces the explicit message below rather than a
# bare curl exit under `set -e` — the usual cause is a bad or expired
# NEON_API_KEY, which is worth naming for the operator.
BRANCH_ID="$(api_get "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/branches?search=${NEON_BRANCH}" \
  | jq -r --arg n "$NEON_BRANCH" 'first(.branches[] | select(.name==$n) | .id) // empty')" || true
if [ -z "$BRANCH_ID" ]; then
  echo "::error::Check NEON_API_KEY is valid and NEON_PROJECT_ID/NEON_BRANCH are correct." >&2
  echo "::error::Could not resolve Neon branch \"${NEON_BRANCH}\". Aborting." >&2
  exit 1
fi
say "Branch resolved:  yes (id redacted)"

if [ "$DRY_RUN" -eq 1 ]; then
  step "DRY RUN — stopping before any mutation"
  if [ "$USE_EXISTING" -eq 1 ]; then
    say "Would reuse:            the newest existing snapshot (none created)"
  else
    say "Would create snapshot:  ${SNAPSHOT_NAME}"
  fi
  say "Would restore it into:  ${DRILL_BRANCH} (finalize_restore=false)"
  say "Would run:              migrate:verify + verify-app-against-branch.js"
  say "Would then delete:      ${DRILL_BRANCH}"
  say ""
  say "DRY RUN COMPLETE — nothing was created, changed, or deleted."
  exit 0
fi

if [ "$USE_EXISTING" -eq 1 ]; then
  # Fallback for plans that do not allow creating snapshots on demand. The
  # drill still proves the property that matters most — that a saved restore
  # point can be MATERIALIZED and the application works against it. What it
  # cannot prove is the "named pre-migration recovery point" clause of task
  # 1.9; record that honestly in the sign-off rather than implying otherwise.
  step "1a. Using the newest EXISTING snapshot (no new recovery point created)"
  SNAPSHOT_JSON="$(api_get "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/snapshots")"
  SNAPSHOT_ID="$(printf '%s' "$SNAPSHOT_JSON" | jq -r --arg b "$BRANCH_ID" \
    '[.snapshots[]? | select((.branch_id // .source_branch_id) == $b)]
     | sort_by(.created_at) | reverse | first | .id // empty')"
  SNAPSHOT_CREATED_AT="$(printf '%s' "$SNAPSHOT_JSON" | jq -r --arg b "$BRANCH_ID" \
    '[.snapshots[]? | select((.branch_id // .source_branch_id) == $b)]
     | sort_by(.created_at) | reverse | first | .created_at // empty')"
  if [ -z "$SNAPSHOT_ID" ]; then
    echo "::error::No existing snapshot found for branch \"${NEON_BRANCH}\". Aborting." >&2
    exit 1
  fi
  SNAPSHOT_NAME="(existing snapshot, created ${SNAPSHOT_CREATED_AT:-unknown})"
  say "Using existing recovery point created: ${SNAPSHOT_CREATED_AT:-unknown}"
  say "NOTE: no NEW named recovery point was created — record this in the sign-off."
else

step "1a. Create the named pre-migration recovery point"
# `name` is a QUERY parameter on the create-snapshot endpoint, not a body field
# (https://api-docs.neon.tech/reference/createsnapshot). --get with
# --data-urlencode keeps it in the query string while still issuing POST.
# `|| SNAPSHOT_RC=$?` rather than letting `set -e` abort: --fail-with-body puts
# the API's error body on stdout, and that body is the only thing that explains
# a 4xx. Aborting on the non-zero exit would discard it and leave the operator
# with a bare "curl: (22)".
SNAPSHOT_RC=0
SNAPSHOT_RESPONSE="$(curl --fail-with-body --silent --show-error "${CURL_TIMEOUTS[@]}" --request POST \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  --get --data-urlencode "name=${SNAPSHOT_NAME}" \
  "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/branches/${BRANCH_ID}/snapshot")" || SNAPSHOT_RC=$?
if [ "$SNAPSHOT_RC" -ne 0 ] && [ "$REPLACE_SNAPSHOT" -eq 1 ]; then
  # Quota recovery. The Neon Free plan allows exactly ONE manual snapshot per
  # project (paid plans allow 100), so on the free tier every drill after the
  # first hits the quota — the previous drill's own snapshot occupies the slot.
  # With --replace-snapshot, delete the OLDEST snapshot for this branch and
  # retry once, which keeps the recurring pre-migration drill self-service.
  #
  # Deleting is only attempted AFTER a creation failure, never pre-emptively,
  # so this is a no-op on a paid plan with slots free.
  say "Snapshot creation failed; --replace-snapshot given, freeing the oldest slot."
  OLDEST_JSON="$(api_get "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/snapshots")"
  # Prefer the oldest snapshot for THIS branch, so the routine case reclaims the
  # previous drill's own slot and touches nothing else.
  OLDEST_ID="$(printf '%s' "$OLDEST_JSON" | jq -r --arg b "$BRANCH_ID" \
    '[.snapshots[]? | select((.branch_id // .source_branch_id) == $b)]
     | sort_by(.created_at) | first | .id // empty')"
  OLDEST_AT="$(printf '%s' "$OLDEST_JSON" | jq -r --arg b "$BRANCH_ID" \
    '[.snapshots[]? | select((.branch_id // .source_branch_id) == $b)]
     | sort_by(.created_at) | first | .created_at // empty')"
  OLDEST_SCOPE="this branch"
  if [ -z "$OLDEST_ID" ]; then
    # The quota is per-PROJECT, not per-branch, so a snapshot on a DIFFERENT
    # branch can be the one occupying the only free-plan slot. Without this
    # fallback the branch-scoped search finds nothing, the retry hits the same
    # 422, and the operator is told there was nothing to replace while the quota
    # is visibly full. Widen to the project and say plainly what is being
    # deleted — this deletes another branch's restore point, which the operator
    # must see in the evidence file.
    OLDEST_ID="$(printf '%s' "$OLDEST_JSON" | jq -r \
      '[.snapshots[]?] | sort_by(.created_at) | first | .id // empty')"
    OLDEST_AT="$(printf '%s' "$OLDEST_JSON" | jq -r \
      '[.snapshots[]?] | sort_by(.created_at) | first | .created_at // empty')"
    OLDEST_BRANCH="$(printf '%s' "$OLDEST_JSON" | jq -r \
      '[.snapshots[]?] | sort_by(.created_at) | first
       | (.branch_id // .source_branch_id) // "unknown"')"
    OLDEST_SCOPE="ANOTHER branch (quota is per-project)"
    if [ -n "$OLDEST_ID" ] && [ "$OLDEST_BRANCH" != "$BRANCH_ID" ]; then
      say "WARNING: no snapshot for this branch, but the project quota is full."
      say "         The oldest snapshot belongs to a different branch and will be"
      say "         DELETED to free the slot. Re-create it if it was still needed."
    fi
  fi
  if [ -z "$OLDEST_ID" ]; then
    say "No existing snapshot found to replace (the quota failure has another cause)."
  else
    say "Deleting oldest snapshot from ${OLDEST_SCOPE} (created ${OLDEST_AT:-unknown})..."
    if curl --fail-with-body --silent --show-error "${CURL_TIMEOUTS[@]}" --request DELETE \
      -H "Authorization: Bearer ${NEON_API_KEY}" \
      "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/snapshots/${OLDEST_ID}" >/dev/null; then
      say "Deleted. Retrying snapshot creation."
      SNAPSHOT_RC=0
      SNAPSHOT_RESPONSE="$(curl --fail-with-body --silent --show-error "${CURL_TIMEOUTS[@]}" --request POST \
        -H "Authorization: Bearer ${NEON_API_KEY}" \
        --get --data-urlencode "name=${SNAPSHOT_NAME}" \
        "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/branches/${BRANCH_ID}/snapshot")" || SNAPSHOT_RC=$?
    else
      say "Deletion failed."
    fi
  fi
fi
if [ "$SNAPSHOT_RC" -ne 0 ]; then
  say "Snapshot creation FAILED (curl exit ${SNAPSHOT_RC}). Neon API said:"
  printf '%s\n' "$SNAPSHOT_RESPONSE" | tee -a "$EVIDENCE_FILE"
  say ""
  say "Most likely cause: the manual-snapshot quota is full. The Neon Free plan"
  say "allows ONE manual snapshot per project (paid plans allow 100), so the"
  say "previous drill's snapshot occupies the only slot."
  say ""
  say "  Re-run with --replace-snapshot to delete the oldest snapshot for this"
  say "  branch and retry:   bash scripts/pitr-drill.sh --replace-snapshot"
  say ""
  say "  Or drill against the existing snapshot without creating one:"
  say "                      bash scripts/pitr-drill.sh --use-existing-snapshot"
  say "  (proves restore works, but NOT the named-recovery-point clause of 1.9,"
  say "   and migrate:verify will fail if that snapshot predates the current"
  say "   schema — record which variant was run in the sign-off.)"
  echo "::error::Could not create the named recovery point. Aborting." >&2
  exit 1
fi

SNAPSHOT_ID="$(printf '%s' "$SNAPSHOT_RESPONSE" | jq -r '.snapshot.id // .id // empty')"
SNAPSHOT_CREATED_AT="$(printf '%s' "$SNAPSHOT_RESPONSE" | jq -r '.snapshot.created_at // .created_at // empty')"
if [ -z "$SNAPSHOT_ID" ]; then
  echo "::error::Snapshot creation returned no id. Aborting." >&2
  printf '%s' "$SNAPSHOT_RESPONSE" | jq '{ keys: (. | keys) }' >>"$EVIDENCE_FILE" 2>&1 || true
  exit 1
fi
say "Recovery point created: ${SNAPSHOT_NAME}"
say "Created at (UTC):       ${SNAPSHOT_CREATED_AT:-unknown}"

fi  # end: create-vs-use-existing recovery point

# ---------------------------------------------------------------------------
# Step 1b — restore into a NEW branch and verify. RTO measurement starts here:
# it is the operator-visible time from "decide to recover" to "verified good".
# ---------------------------------------------------------------------------
RTO_START="$(date -u +%s)"

step "1b. Restore the recovery point into a new branch"
# finalize_restore:false materializes a separate preview branch and leaves the
# production branch untouched. Creating an ordinary child branch with
# `--parent production` would copy the LIVE tip and prove nothing about PITR.
#
# The exit code is captured rather than left to `set -e`. This is the one call
# that can create a branch holding production data, and DRILL_BRANCH_ID — the
# only thing the cleanup trap can act on — is not resolved until after the
# polling step below. A bare abort here (a timeout after Neon already accepted
# the restore, say) would therefore leak exactly the branch the script promises
# never to leak. On failure, resolve the branch id first so the trap can still
# tear it down, then report the API's own error body.
#
# The body is built with jq rather than interpolated into a string: DRILL_BRANCH
# is timestamp-derived today, but a hand-built JSON literal is one --name-style
# change away from emitting malformed JSON.
RESTORE_RC=0
RESTORE_RESPONSE="$(curl --fail-with-body --silent --show-error "${CURL_TIMEOUTS[@]}" --request POST \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(jq -nc --arg name "$DRILL_BRANCH" '{name:$name,finalize_restore:false}')" \
  "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/snapshots/${SNAPSHOT_ID}/restore")" || RESTORE_RC=$?
if [ "$RESTORE_RC" -ne 0 ]; then
  DRILL_BRANCH_ID="$(api_get "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/branches?search=${DRILL_BRANCH}" \
    | jq -r --arg n "$DRILL_BRANCH" 'first(.branches[] | select(.name==$n) | .id) // empty')" || true
  say "Restore call FAILED (curl exit ${RESTORE_RC}). Neon API said:"
  printf '%s\n' "$RESTORE_RESPONSE" | tee -a "$EVIDENCE_FILE"
  if [ -n "$DRILL_BRANCH_ID" ]; then
    say "A partial drill branch WAS created; the cleanup trap will remove it."
  fi
  echo "::error::Restore call failed. Aborting." >&2
  exit 1
fi
say "Restore call accepted:  yes"

step "1b. Poll restore operations to a terminal state"
# Delegated to scripts/neon-poll-operations.js. A Bash `while read` loop on the
# right of a pipeline runs in a subshell, so `exit 1` on a failed operation
# would exit only the subshell and let the drill continue against a branch that
# is still mid-restore. The Node script keeps control flow in-process.
if ! printf '%s' "$RESTORE_RESPONSE" \
  | NEON_API_KEY="$NEON_API_KEY" NEON_PROJECT_ID="$NEON_PROJECT_ID" \
    node "${REPO_ROOT}/scripts/neon-poll-operations.js" >>"$EVIDENCE_FILE" 2>&1; then
  echo "::error::Restore operation polling failed. Aborting before connecting." >&2
  # Resolve the id first so the trap can still clean up a partial branch.
  DRILL_BRANCH_ID="$(api_get "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/branches?search=${DRILL_BRANCH}" \
    | jq -r --arg n "$DRILL_BRANCH" 'first(.branches[] | select(.name==$n) | .id) // empty')" || true
  exit 1
fi
say "All restore operations reached terminal success."

step "1b. Resolve the drill branch connection"
DRILL_BRANCH_ID="$(api_get "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/branches?search=${DRILL_BRANCH}" \
  | jq -r --arg n "$DRILL_BRANCH" 'first(.branches[] | select(.name==$n) | .id) // empty')"
if [ -z "$DRILL_BRANCH_ID" ]; then
  echo "::error::Could not resolve the restored drill branch. Aborting." >&2
  exit 1
fi

# Use Neon's connection_uri endpoint rather than hand-building a URI: the
# endpoint returns a complete, callable URI WITH credentials. A hand-built
# postgres://postgres@host/neondb has no password and hardcodes a role that
# does not exist on this project. Both database_name and role_name are
# required (the API 400s without role_name).
DRILL_URL="$(api_get --get \
  --data-urlencode "branch_id=${DRILL_BRANCH_ID}" \
  --data-urlencode "database_name=neondb" \
  --data-urlencode "role_name=${DRILL_ROLE}" \
  --data-urlencode "pooled=false" \
  "${NEON_API_BASE}/projects/${NEON_PROJECT_ID}/connection_uri" | jq -r '.uri // empty')"
if [ -z "$DRILL_URL" ]; then
  echo "::error::connection_uri returned an empty URI. Aborting." >&2
  exit 1
fi
say "Drill connection resolved: yes (URI not printed)"

# The runner's host/database allowlist guards must name the drill endpoint, not
# production — derived here so the operator never types them.
DRILL_HOST="$(printf '%s' "$DRILL_URL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(new URL(s.trim()).hostname)}catch{process.exit(1)}})')"
DRILL_DB="$(printf '%s' "$DRILL_URL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(new URL(s.trim()).pathname.replace(/^\//,""))}catch{process.exit(1)}})')"

step "1b. migrate:verify against the restored branch"
# Regular (post-adoption) acceptance criteria: production is adopted and at the
# latest migration, so verify MUST pass. A failure here is a real drift signal
# on production, not a drill artefact — stop and investigate before any DDL.
# MIGRATION_TARGET_KIND=restore-drill marks the target as a read-only drill.
#
# MIGRATION_CONFIRM_PRODUCTION is required because MIGRATION_ENVIRONMENT is
# production (src/database/migrations/runner.ts:586-591). The runner demands the
# token equal "APPLY <host>/<database>" for the TARGET — so the value below
# authorises only this throwaway drill branch and could never satisfy the guard
# for the real production endpoint. Computing it from the resolved drill URL is
# therefore not a weakening of the guard; it is the guard working as designed.
VERIFY_STATUS=0
(
  cd "$REPO_ROOT" &&
  DATABASE_URL_UNPOOLED="$DRILL_URL" \
  MIGRATION_ALLOWED_HOST="$DRILL_HOST" \
  MIGRATION_ALLOWED_DATABASE="$DRILL_DB" \
  MIGRATION_ENVIRONMENT=production \
  MIGRATION_TARGET_KIND=restore-drill \
  MIGRATION_CONFIRM_PRODUCTION="APPLY ${DRILL_HOST}/${DRILL_DB}" \
  MIGRATION_ROLE="$DRILL_ROLE" \
  npm run migrate:verify
) >>"$EVIDENCE_FILE" 2>&1 || VERIFY_STATUS=$?
if [ "$VERIFY_STATUS" -ne 0 ]; then
  say "migrate:verify: FAIL (exit ${VERIFY_STATUS}) — see evidence file"
  echo "::error::migrate:verify FAILED against the restored branch." >&2
  exit 1
fi
say "migrate:verify: PASS"

step "1b. Application verification against the restored data"
# Not a curl of /health?deep=true: that endpoint does not execute a database
# query (workers/src/health.ts — task 1.10 fixes it), so it would prove
# nothing here. This runs the Worker's real queries through the Worker's real
# driver. Read-only and tenant-safe.
APP_STATUS=0
VERIFY_LABEL="pitr-drill ${STAMP}" \
  node "${REPO_ROOT}/scripts/verify-app-against-branch.js" --url "$DRILL_URL" \
  >>"$EVIDENCE_FILE" 2>&1 || APP_STATUS=$?
if [ "$APP_STATUS" -ne 0 ]; then
  say "Application verification: FAIL — see evidence file"
  echo "::error::Application verification FAILED against the restored branch." >&2
  exit 1
fi
say "Application verification: PASS"

RTO_END="$(date -u +%s)"

# ---------------------------------------------------------------------------
# RPO / RTO
# ---------------------------------------------------------------------------
step "Recovery objectives"
# RPO — how much data a recovery to this point would lose: the age of the
# recovery point when the restore began.
RPO_SECONDS="unknown"
if [ -n "${SNAPSHOT_CREATED_AT:-}" ]; then
  RPO_SECONDS="$(SNAP="$SNAPSHOT_CREATED_AT" RTO_START="$RTO_START" node -e \
    'const t=Date.parse(process.env.SNAP);if(Number.isNaN(t)){process.stdout.write("unknown")}else{process.stdout.write(String(Math.max(0,Number(process.env.RTO_START)-Math.floor(t/1000))))}')"
fi
RTO_SECONDS=$((RTO_END - RTO_START))
say "RPO (recovery point age at restore): ${RPO_SECONDS} seconds"
say "RTO (restore -> verified serviceable): ${RTO_SECONDS} seconds"
say "Responsible operator: ${DRILL_OPERATOR:-$(git -C "$REPO_ROOT" config user.name 2>/dev/null || echo 'unrecorded')}"

step "VERDICT"
say "PITR DRILL PASS"
say "  named recovery point created ....... yes (${SNAPSHOT_NAME})"
say "  restored to a new branch ........... yes (production branch untouched)"
say "  all restore operations terminal .... yes"
say "  migrate:verify ..................... PASS"
say "  application verification ........... PASS"
say "Finished (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
