## Context

UBS findings include critical issues around secret handling and warning-level patterns that can cause runtime failures. We will focus on low-effort, high-impact fixes across backend and workers without changing product behavior.

## Goals / Non-Goals

**Goals:**

- Remove hardcoded secret fallbacks and require env vars at startup.
- Keep .env files untracked and ensure examples do not contain secrets.
- Resolve a small, vetted set of high-merit warning findings.

**Non-Goals:**

- Broad refactors or large-scale warning cleanups.
- Behavior changes to API responses or feature workflows.
- Global sanitization of all JSON responses.

## Decisions

- Prefer fail-fast configuration checks over permissive defaults for secrets.
- Treat UBS HTML sink warnings as false positives unless a real HTML sink is found.
- Limit warning fixes to items with clear correctness or security benefits.

## Risks / Trade-offs

- Strict env validation may break misconfigured dev setups -> document required vars and update .env.example if needed.
- Narrow scope may leave some UBS warnings for a later sweep -> track with follow-up if needed.
