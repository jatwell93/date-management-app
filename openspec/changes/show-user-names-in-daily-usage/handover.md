# Handover: show-user-names-in-daily-usage

Updated: 2026-10-23 · main at f1430511

## State

Task 1.1 (Worker) is implemented on `feature/factory-show-user-names-in-daily-usage-1.1` and waits for the owner's merge. `getDailyUsageReport` now returns `user_name` (`COALESCE(u.username, u.email)`), and the `users` join is scoped to the audit row's organisation. `workers/src/database.daily-usage.pglite.node.test.ts` covers it; the cross-tenant case fails with the join scoping removed (checked). `npm run test:db`, the workers typecheck and `npm run lint` pass.

## Next

Task 2.1, the frontend. It starts only after 1.1 merges.

## Open PRs

- Factory PR for task 1.1 (label `factory:show-user-names-in-daily-usage`).

## Waiting on the user

- Merge the task 1.1 PR.

## Learnings

- The `LEFT JOIN users u ON al.user_id = u.id` in `getDailyUsageReport` had no organisation condition. Adding the name without scoping that join would let a cross-tenant `user_id` leak another organisation's username.
- `getItemsByUserReport` already names users with `COALESCE(u.username, u.email, 'Unknown')`; this change returns null instead of `'Unknown'` so the page owns the fallback wording.
- `workers/node_modules` is not installed on a fresh runner; run `npm ci --prefix workers` before `npm run test:db`.
