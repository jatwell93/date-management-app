## Why

Recent UBS scans show critical and warning findings with high merit (hardcoded secrets, unsafe defaults, and a few recurring warning patterns). Addressing the most actionable items now reduces security risk and prevents future regressions.

## What Changes

- Remove unsafe secret fallbacks and enforce required env vars at startup.
- Ensure local .env files remain untracked and examples stay non-sensitive.
- Fix a small set of high-impact warning patterns after code review (e.g., unsafe JSON parsing, timer cleanup).

## Capabilities

### New Capabilities

- `secure-config-validation`: Fail-fast startup validation for required secrets.

### Modified Capabilities

- None.

## Impact

- Backend: environment configuration, auth/bootstrap logic, selected routes/services/tests.
- Workers: JWT secret handling defaults.
- Repo hygiene: confirm .env files are ignored and not tracked.
