# Proposal: Show user names in the daily usage report

## Why

Issue #671. On the usage report (`/usage-report`) the daily activity "User" column shows the numeric `user_id`, because `GET /api/reports/daily-usage` returns no name. Store managers cannot tell who did what.

This is also the factory's first real change run end to end (`add-spec-factory-runner` task 2.3): two dependent tasks, the second started by the merge of the first.

## What changes

- **Worker:** `getDailyUsageReport` (`workers/src/database.ts:1960`) returns `user_name` with each row, as `COALESCE(u.username, u.email)`, the same choice `getItemsByUserReport` makes for its `userName`. The `users` join is scoped to the caller's organisation (`u.organization_id = al.organization_id`), so a row can never carry a name from another tenant; an unmatched user gives `user_name: null`. The `DailyUsageReportItem` type (`workers/src/database.ts:721`) gains the field.
- **Frontend:** `UsageReportPage.tsx` shows `user_name` in the daily activity table and in the mobile summary list (which today shows no user at all), falling back to `Unknown user <id>`, the wording the page already uses for its other tables.

## Out of scope

- Other report endpoints and the `audit_log` schema.
- Showing email addresses anywhere they are not already shown.

## Autonomy

```yaml
merge: human
no_go:
  - workers/migrations/**
  - backend/**
```

The baseline protected paths (`scripts/check-no-go.js`) apply as well. No migration is needed: the name comes from an existing join.
