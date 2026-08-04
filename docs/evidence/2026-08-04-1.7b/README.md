# Task 1.7.B-execute — first production deploy evidence (2026-08-04)

Evidence captured for the first operator-driven production deploy of the
migration + Worker deploy gate. Sign-off lives in
[`docs/migrations-deploy-runbook.md`](../../migrations-deploy-runbook.md#sign-off).

| File | What it shows |
|------|---------------|
| `pitr-drill-poll-evidence.json` | Pre-adoption PITR drill — `ok:true`, 3 Neon ops `finished/success` (project `PROJECT-REDACTED`). |
| `pitr-drill-restore-response.json` | Neon restore-to-branch response for the PITR drill (secret-free — no connection URI/password). |
| `runtime-role-evidence-production.json` | Runtime-role verification on the Neon production branch — `role:app_runtime`, `mode:read-only`, `pass:true` (passwords redacted by `verify-runtime-role.js`). |
| `adopt-dry-run-0009.txt`, `adopt-dry-run-0009b.txt`, `adopt-dry-run-1.txt` | Adoption dry-run reports (adoption point `0009`). |

Canonical CI evidence (migration/canary artifacts) lives on the workflow run:
<https://github.com/jatwell93/date-management-app/actions/runs/30868236574>
(SHA `b240631a`, conclusion `success`).

> **Redaction note.** Production infrastructure identifiers — Neon endpoint
> hostnames, project/branch/snapshot/endpoint IDs, and Clerk user/org IDs —
> have been replaced with `REDACTED` placeholders in these files and in the
> runbook sign-off. All verification results, statuses, and counts are
> preserved verbatim. Authoritative identifier values live in the protected
> GitHub `production` environment, Doppler, and operator notes (not in-repo),
> matching the redaction convention used elsewhere (e.g. `docs/cloudflare-setup.md`).

> These files were reviewed and contain no plaintext secrets (no connection
> strings, API keys, or passwords) before being committed.
