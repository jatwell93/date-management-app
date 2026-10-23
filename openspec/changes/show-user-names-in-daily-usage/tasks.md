# Tasks: Show user names in the daily usage report

Each task is one factory run and one PR. Task 2 needs task 1's API field, so it starts only after task 1 merges.

## 1. Worker

- [ ] 1.1 In `getDailyUsageReport` (`workers/src/database.ts:1960`), select `COALESCE(u.username, u.email) as user_name`, add `AND u.organization_id = al.organization_id` to the `LEFT JOIN users u` condition, and add `user_name` to the `GROUP BY`. Add `user_name: string | null` to `DailyUsageReportItem` (`workers/src/database.ts:721`).
      Acceptance: a real-SQL test (pglite, following an existing `workers/src/*.pglite.node.test.ts` file and `docs/cross-tenant-isolation-assurance.md`) seeds two organisations whose users share nothing, writes audit rows for each, and asserts that org A's report names org A's user, never names org B's user, and gives `user_name: null` for an audit row whose user is in another organisation. The test must fail without the join scoping (check by removing it). `npm run test:db` and `(cd workers && npm run typecheck)` pass.

## 2. Frontend

- [ ] 2.1 In `frontend/src/pages/UsageReportPage.tsx`, add `user_name: string | null` to `DailyUsageReportItem` and show it in the daily activity table's "User" column, falling back to `Unknown user <id>` when it is null or empty (the wording the page already uses at line 85).
      Acceptance: `frontend/src/tests/UsageReportPage.test.tsx` covers a row with a name and a row with `user_name: null`; `npm run test:frontend:diff` and the frontend typecheck pass.
