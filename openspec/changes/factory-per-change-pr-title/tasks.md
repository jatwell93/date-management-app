# Tasks: Title a finished per-change PR after its change

Built in an interactive session: the task touches a `no_go` path.

## 1. Router

- [ ] 1.1 `markReady` titles the PR after its change: a pure `changeTitle(title, heading, id)` in `scripts/factory-route.js` builds `<type(scope)>: <heading> (<id>)` from the current title's conventional prefix (with any `WIP:` removed) and the proposal heading. It returns the title with `WIP:` stripped when the prefix or the heading is missing. `defaultDeps` reads `proposal.md` from the branch's `openspec/changes/archive/<date>-<id>/` folder with `branchFile` and `missingAsEmpty`. `handOverRoute` passes the change id through to `markReady`.
      Demo: a finished per-change PR titled `WIP: docs(openspec): start the tickets proof file (factory-tickets-proof 1.1)` becomes `docs(openspec): prove tickets to archive (factory-tickets-proof)`.
      Acceptance: unit tests for `changeTitle` (scoped prefix, unscoped prefix, `!` breaking prefix, no prefix, empty heading, heading without `Proposal:`); a router test that `markReady` gets the change id; mutation-verify each one. `npm run test:tooling` and `npm run lint` pass.

## 2. Proof

- [ ] 2.1 The next per-change PR that the factory finishes gets the change title, and its squash commit on `main` uses that title. Record the result in `handover.md`.
      Blocked by: 1.1.
