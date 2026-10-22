# Handover: add-agent-route-map-and-tooling-polish

Updated: 2026-10-22 · branch feature/factory-add-agent-route-map-and-tooling-polish-1.1

## State

Task 1.1 done on the branch (`scripts/route-map.js`, its test, `route-map` root script, `workers/README.md` pointer); PR pending the owner's merge. Tasks 1.2 and 1.3 not started.

## Next

Task 1.2, `--summary` for `scripts/pr-feedback.js`, once 1.1 is merged.

## Open PRs

- Task 1.1 factory PR (label `factory:add-agent-route-map-and-tooling-polish`).

## Waiting on the user

- Merge of the task 1.1 PR.

## Learnings

- `MINIMAL_API_ROUTES` is at `workers/src/index-minimal.ts:335`; path patterns are `RE_*` constants defined just above it. Most handlers are declared in `index-minimal.ts` itself; some are imported from other modules (for example `./clerk/bootstrap-handler`). `./minimal-api-routes` exports only the route type and the resolvers, not handlers.
- `route-map.js` tokenizes the table (strings, regex literals, comments) rather than using line regexes, so multi-line entries and `[^/]` classes parse. It takes `--root <dir>` for fixtures.
