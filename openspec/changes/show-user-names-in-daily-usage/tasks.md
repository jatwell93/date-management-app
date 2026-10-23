# Tasks: Show user names in the daily usage report

Each task is one factory run and one PR. Task 2 needs task 1's API field, so it starts only after task 1 merges.

## 1. Worker

- [x] 1.1 In `getDailyUsageReport` (`workers/src/database.ts:1960`), select `COALESCE(u.username, u.email) as user_name`, add `AND u.organization_id = al.organization_id` to the `LEFT JOIN users u` condition, and add `user_name` to the `GROUP BY`. Add `user_name: string | null` to `DailyUsageReportItem` (`workers/src/database.ts:721`).
      Acceptance: a real-SQL test (pglite, following an existing `workers/src/*.pglite.node.test.ts` file and `docs/cross-tenant-isolation-assurance.md`) seeds two organisations whose users share nothing, writes audit rows for each, and asserts that org A's report names org A's user, never names org B's user, and gives `user_name: null` for an audit row whose user is in another organisation. The test must fail without the join scoping (check by removing it). `npm run test:db` and `(cd workers && npm run typecheck)` pass.

## 2. Frontend

- [ ] 2.1 In `frontend/src/pages/UsageReportPage.tsx`, add `user_name: string | null` to `DailyUsageReportItem` and show it in both views of the daily activity data: the desktop table's "User" column, and the mobile summary list (`<ul ... md:hidden aria-label="Daily activity">`), which today shows the date and role but no user at all; put the name in each card's header beside the role. Fall back to `Unknown user <id>` when it is null or empty (the wording the page already uses at line 85), through one shared helper so both views agree. `audit_log.user_id` is nullable, so `user_id` can be null too: then the helper shows `Unknown user`, never `Unknown user null`; type `user_id` as `number | null`.
      Acceptance: `frontend/src/tests/UsageReportPage.test.tsx` covers a row with a name, a row with `user_name: null`, and a row with both `user_name` and `user_id` null, and asserts the name in both the table and the mobile list; `npm run test:frontend:diff` and the frontend typecheck pass.
