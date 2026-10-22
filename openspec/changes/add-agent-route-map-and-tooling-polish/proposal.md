# Proposal: Agent route map and tooling polish

## Why

This is the factory's pilot change (`add-spec-factory-runner`, task 1.3). Its tasks are small, low-risk and independent, and none touches a protected path, so they prove the unattended loop end to end without risking the app.

Each task also removes a cost found in the 2026-10-21 retro:

- Agents page through `workers/src/index-minimal.ts` (5,000+ lines) with `sed -n` and `grep -n` to find which handler serves a route. About 250 such calls were counted in the recent sessions.
- `pr-feedback.js` prints a large JSON report. Logs and the planned daily digest need one line per PR.
- `cleanup-merged.js` keeps branches it cannot prove are merged, and says why, but not what to run if the owner wants them gone.

## What changes

- **`scripts/route-map.js`** prints one line per API route of the deployed Worker: method, path (or path pattern), handler name, and the `file:line` where the handler is defined. It reads `MINIMAL_API_ROUTES` in `workers/src/index-minimal.ts` and resolves each handler in `workers/src/`. A test runs it on the real source, so the map cannot go stale: a route whose handler it cannot locate fails the test. `workers/README.md` points to it.
- **`node scripts/pr-feedback.js <pr> --summary`** prints one line instead of the JSON report, for example `#686 settled=false waitingOn=quiet window actionable=1 checks=21 pass/0 fail/0 pending`.
- **`cleanup-merged.js`** prints the manual command after each branch it keeps: `git branch -D <name>` for unverified local commits, and `git -C <path> status` for a dirty worktree. It still never runs them.

## Out of scope

- Splitting `index-minimal.ts`.
- Any change to how `cleanup-merged.js` decides what to delete.
- An ESLint required-check job (it edits `.github/**`, a protected path).

## Autonomy

```yaml
merge: human
no_go:
  - workers/src/** # the map reads Worker source; it must never edit it
  - frontend/**
```

The baseline protected paths (`scripts/check-no-go.js`) apply as well.
