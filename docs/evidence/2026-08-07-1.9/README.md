# Task 1.9 — production recovery verification evidence (2026-08-07)

Evidence for the **regular, post-adoption** PITR drill against the Neon
production branch. Sign-off lives in
[`docs/migrations-deploy-runbook.md`](../../migrations-deploy-runbook.md#recovery-policy-sign-off-task-19).

| File | What it shows |
|------|---------------|
| `drill-run.txt` | Full `scripts/pitr-drill.sh --replace-snapshot` run: readiness + retention JSON, named recovery point, restore + 5 operations `finished/success`, `migrate:verify` PASS, application verification PASS (6/6), RPO/RTO. |

Operator: Josh Atwell (`jatwell93`). Drill run `pre-migration-20260807035216`,
completed 2026-08-07T03:52:40Z.

## Why this drill was framed as post-adoption

Task 1.9 is worded "before first migration", but production was adopted at
`0009` and cut over to `0011` on 2026-07-31 (task 1.7.B). The pre-first-migration
moment had passed, so the clause with remaining force is the recurring one:
prove the **current** schema is recoverable and serviceable before the next
production DDL. Accordingly this drill used **regular post-adoption acceptance
criteria** — `migrate:verify` had to genuinely PASS, unlike the 1.7.B
pre-adoption drill which used `migrate:preflight`.

## Results

| Clause of task 1.9 | Result |
|---|---|
| Active Neon retention/PITR | `history_retention_seconds: 21600` (6h), gate `retention.ok: true` |
| Named pre-migration recovery point | `pre-migration-20260807035216`, created 03:52:22Z |
| Restore-to-new-branch drill | 5 operations all `finished`/`success`; production branch untouched (`finalize_restore: false`) |
| Application verification | 6/6 checks PASS via the Worker's own `@neondatabase/serverless` driver |
| RPO / RTO | 3 s / 13 s — see the caveat below |
| Responsible operator | `jatwell93` |

`migrate:verify` against the restored branch: Tables OK, reference data OK
(54 rows), catalog vs fingerprint OK — **production carries no schema drift**.

Application verification detail: ledger head `0011` (`state=applied`), no
interrupted rows, all 6 `/api/subscription/current` columns resolved, 33 public
tables, 5 oversized int8 `tier_feature_flags.limit_value` rows read without
error (driver returns int8 as a JS string).

## What the RPO/RTO numbers do and do not mean

**Read these as a floor, not as the operating RPO.**

- **RPO 3 s** is the age of the recovery point at the moment of restore. It is
  low *because the drill created the snapshot immediately before restoring*.
  It demonstrates the **planned-migration** case: take a named recovery point
  immediately before DDL and the data loss on rollback is near zero.
- For an **unplanned** incident there is no fresh snapshot waiting. Recovery
  reaches back only as far as the newest available restore point, bounded by
  the 6-hour retention window. That, not 3 seconds, is the number to plan
  incident response around. See
  [`docs/neon-backup-restore.md`](../../neon-backup-restore.md).
- **RTO 13 s** is restore-call → verified-serviceable for a database of this
  size, excluding human decision time. Real incident RTO is dominated by
  detection and the decision to restore, not by Neon.

## Constraints and findings surfaced by this drill

1. **Neon Free plan allows exactly ONE manual snapshot per project.** The first
   two attempts failed with HTTP 422 because the slot held the pre-adoption
   snapshot from 1.7.B. Every drill creates a snapshot, so *every* drill after
   the first hits this. `scripts/pitr-drill.sh --replace-snapshot` is therefore
   the steady-state invocation on this plan. Consequence to hold: the project
   retains exactly one manual restore point, always the most recent. Continuous
   PITR history is a separate mechanism and is unaffected.
2. **Runbook bug — missing `MIGRATION_CONFIRM_PRODUCTION`.** The manual Step 1b
   block set `MIGRATION_ENVIRONMENT=production` without the confirmation token
   the runner requires, so a hand-run drill would have failed with
   *"Explicit production confirmation is required"*. Undetected until now
   because the 1.7.B drill ran `migrate:preflight`, never `migrate:verify`.
   Fixed in the runbook and the script.
3. **Driver adapter bug.** `neon()` is a tagged-template function; calling it
   as a plain function with `$1` placeholders is rejected by
   `@neondatabase/serverless` v1. `sql.query(text, params)` is the conventional
   entry point. Fixed and pinned by unit tests, including one that constructs
   the real client and asserts `.query` exists.

> **Redaction note.** Production infrastructure identifiers — Neon endpoint
> hostnames, project/branch/snapshot IDs, and operation UUIDs — are replaced
> with `REDACTED` placeholders. All verification results, statuses, counts, and
> timings are preserved verbatim. Authoritative identifiers live in the
> protected GitHub `production` environment, Doppler, and operator notes (not
> in-repo), matching the convention used for
> [`2026-08-04-1.7b`](../2026-08-04-1.7b/README.md).

> Reviewed for plaintext secrets before committing: no connection strings, API
> keys, or passwords. The drill script never prints the connection URI, and the
> application verifier records only a redacted host.
