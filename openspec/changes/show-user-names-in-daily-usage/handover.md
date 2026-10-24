# Handover: show-user-names-in-daily-usage

Updated: 2026-10-23 · main at e5ad554e

## State

Task 1.1 (Worker) is merged (#701). Task 2.1 (frontend) is implemented on `feature/factory-show-user-names-in-daily-usage-2.1` and waits for the owner's merge. `UsageReportPage.tsx` shows `user_name` in the daily table's "User" column and in each mobile card header beside the role, through one helper (`formatDailyUserLabel`): name, else `Unknown user <id>`, else `Unknown user` when `user_id` is null. `user_id` is now `number | null`. `UsageReportPage.test.tsx` covers a named row, a null-name row and a null-name/null-id row in both views; the new assertions fail with the page change reverted (checked). `npm run test:frontend:diff`, `npm run lint` and `npm run build:frontend` pass.

## Next

Every task is ticked. After the 2.1 PR merges, the owner archives the change (`openspec archive show-user-names-in-daily-usage --yes`).

## Open PRs

- Factory PR for task 2.1 (label `factory:show-user-names-in-daily-usage`).

## Waiting on the user

- Merge the task 2.1 PR, then archive the change.

## Learnings

- `workers/node_modules` and `frontend/node_modules` are not installed on a fresh runner; run `npm ci --prefix <pkg>` first.
- Mobile card key `${date}-${user_id}` can repeat when `user_id` is null; harmless for the current rows but worth a stable key if the query ever returns several null-user rows per day.
