# Rollback Drill Report - 2026-03-07

## Drill Objective

Validate rollback readiness from Cloudflare Workers to Express/VPS target using the documented procedure in [rollback-procedure.md](rollback-procedure.md).

## Drill Type

- Environment: staging simulation
- Execution date (UTC): 2026-03-07
- Executed by: engineering
- Expected outcome: rollback target service boots, health endpoint responds, and data-export prerequisite succeeds

## Steps Executed

### 1. Data safety prerequisite check

Command:

```bash
doppler run -- npm run export:neon-to-sqlite -- --dry-run --no-include-pg-dump
```

Result: PASS

- 20 tables discovered
- 20 tables processed
- source rows: 8
- manifest generated:
  - `backend/backups/neon-export-2026-03-07T01-10-22-372Z.manifest.json`

### 2. Rollback target service startup check (production mode)

Attempt 1 command:

```bash
doppler run --command "NODE_ENV=production PORT=3002 npm start"
```

Result: FAIL (Windows shell env var syntax issue)

- Error: `'NODE_ENV' is not recognized as an internal or external command`

Attempt 2 command (Windows-compatible syntax):

```bash
doppler run --command "cmd /c set NODE_ENV=production&& set PORT=3002&& npm start"
```

Result: FAIL (application boot failure)

- TypeScript compile error:
  - `src/types/subscription.ts:17:8`
  - `Cannot find module '../../shared/types/subscription' or its corresponding type declarations.`

### 3. API verification

Blocked because rollback target failed to start.

- `/health` verification: NOT EXECUTED
- authenticated endpoint checks: NOT EXECUTED
- frontend cutover verification: NOT EXECUTED

## Drill Outcome

- Overall status: PARTIAL / FAILED
- Rollback procedure was executed and validated up to service startup.
- Data-export safeguard path is working.
- Critical blocker found: rollback target cannot boot in production mode due to TypeScript import path/module resolution issue.

## Lessons Learned

1. The rollback runbook must include Windows-compatible command variants for environment variable injection.
2. Rollback readiness requires a production boot check in CI/CD, not just development boot checks.
3. The rollback target is not currently deployment-ready until the `shared` type import issue is fixed.

## Corrective Actions

Priority 1:

- Fix module path/type resolution for `src/types/subscription.ts` in production start path.
- Add `npm start` production boot smoke test to CI (staging profile).

Priority 2:

- Add platform-specific startup commands to [rollback-procedure.md](rollback-procedure.md):
  - Linux/macOS env format
  - Windows `cmd /c set ... &&` format

Priority 3:

- Re-run drill immediately after fix and capture full endpoint verification:
  - `/health`
  - auth-protected endpoint
  - frontend/API cutover check

## Re-Drill Addendum (2026-03-07)

### Fix applied before re-drill

- Updated shared subscription type import in `backend/src/types/subscription.ts` from `../../shared/types/subscription` to `../../../shared/types/subscription`.

### Re-drill execution

Command used to start rollback target service on Windows:

```bash
doppler run --command "cmd /c set NODE_ENV=production&& set PORT=3002&& npm start"
```

Result: PASS (service booted and remained running)

Verification checks:

- `GET /` on `http://127.0.0.1:3002/` -> `200`
- `GET /health/live` on `http://127.0.0.1:3002/health/live` -> `200`
- `GET /health/health` -> `503` (tier feature flags not configured)
- `GET /health/ready` -> `503` (tier feature flags not configured)

### Re-drill assessment

- Rollback boot blocker from initial drill is resolved.
- Rollback target can start in production mode using Windows-compatible startup syntax.
- Readiness remains blocked by data/config state (`tier_feature_flags` configuration), not by runtime boot failure.

### Additional corrective actions

- Add pre-rollback validation step to ensure required tier feature flags are seeded in the rollback target environment.
- Include explicit probe paths in rollback procedure:
  - liveness: `/health/live`
  - readiness: `/health/ready`
  - detailed health: `/health/health`

## Next Drill Trigger

- Re-drill after tier feature flags are fully seeded in staging rollback target
- Quarterly recurring drill thereafter

## Final Validation Addendum (2026-03-07)

### Immediate next step executed

- Seeded missing `tier_feature_flags` values in rollback target using:

```bash
DATABASE_URL="file:./database.sqlite" node scripts/seed-tier-feature-flags.js
```

- Updated the seed data to include required feature keys for all applicable tiers:
  - `dedicated_support`
  - `custom_integrations`

### Final re-drill verification

Service startup command (Windows-compatible):

```bash
doppler run --command "cmd /c set NODE_ENV=production&& set PORT=3002&& set DATABASE_PROVIDER=sqlite&& set DATABASE_URL=file:./database.sqlite&& npm start"
```

Verification results:

- `GET /` on `http://127.0.0.1:3002/` -> `200`
- `GET /health/live` on `http://127.0.0.1:3002/health/live` -> `200`
- `GET /health/ready` on `http://127.0.0.1:3002/health/ready` -> `200`
- `GET /health/health` on `http://127.0.0.1:3002/health/health` -> `healthy`

### Final assessment

- Rollback target now boots and passes liveness/readiness/detailed health checks.
- Tier feature flags are configured and no longer block readiness.
- The rollback drill objective is now fully validated for this cycle.
