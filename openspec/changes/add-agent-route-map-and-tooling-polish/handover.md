# Handover: add-agent-route-map-and-tooling-polish

Updated: 2026-10-23 · main at cdfb9974

## State

Pilot change for the factory runner (`add-spec-factory-runner` task 1.3). Written by hand; no task started.

## Next

Task 1.1, `scripts/route-map.js`. It is meant to be the factory's first run (`add-spec-factory-runner` task 1.4), dispatched once `factory.yml` is on `main` and the `main` ruleset requires an approval.

## Open PRs

- None.

## Waiting on the user

- Nothing.

## Learnings

- `MINIMAL_API_ROUTES` is at `workers/src/index-minimal.ts:335`; path patterns are `RE_*` constants defined just above it. Some handlers are imported from other modules (for example `./minimal-api-routes`).
