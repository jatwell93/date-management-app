# Task 1.6.B-execute — Neon dev-branch gate evidence (2026-08-05)

Evidence captured for the operator-driven Neon dev-branch migration gate
(isolated throwaway branches, **not** production). Sign-off lives in
[`docs/migrations-e2e-runbook.md`](../../migrations-e2e-runbook.md#sign-off).

This drill is reconciled for migration `0011_add_subscription_period_fields`,
which landed after the runbook was authored. 0011 touches `subscription_tiers`
(a different table from `tier_feature_flags`) and is orthogonal to the 0010
down/forward-fix proof, which remains the Prisma-removal gate. Adoption at 0009
leaves both 0010 and 0011 pending; the rollback drill targets 0010 only.

| File | What it shows |
|------|---------------|
| `step1-fresh-install.txt` | Step 1 — fresh install on the empty FRESH branch: preflight READY, apply 12 (0000→0011), seed 54, verify PASS, status clean. |
| `step2-down-forward-fix.txt` | Step 2 — adopt at 0009, apply 0010+0011, guarded 0010 down (first attempt refused on out-of-int4 rows, succeeds after explicit lossy prep), verify FAIL, forward-fix re-apply, verify PASS. |
| `step3-restore-drill.txt` | Step 3 — Neon PITR **LSN restore-in-place** (`neonctl branches restore ^self@<LSN>`): a DDL change is rolled back while `limit_value`/ledger stay intact; RPO/RTO. |
| `step4-old-worker-smoke.txt` | Step 4 — lightweight compat proof: the pre-0011 Worker query (SHA `4cef28f0`) + an int8 `limit_value` read via `@neondatabase/serverless` against the post-0010/0011 ADOPTION branch, both without error. |

CI `Migrations E2E Gate` run URL: `https://github.com/jatwell93/date-management-app/actions/runs/31070788459` (PR #441, success)

> **Redaction note.** Dev-branch infrastructure identifiers — Neon endpoint
> hostnames, project/branch/snapshot/endpoint IDs, and any preview Worker URLs —
> are replaced with `REDACTED` placeholders in these files and in the runbook
> sign-off. All verification results, statuses, and counts are preserved
> verbatim. Connection strings (with embedded passwords) are never echoed in
> full per the runbook's redaction guidance.

> These files will be reviewed for plaintext secrets (no connection strings,
> API keys, or passwords) before being committed.
