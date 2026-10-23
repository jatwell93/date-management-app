# Handover: show-user-names-in-daily-usage

Updated: 2026-10-23 · main at 87ee52ed

## State

Written by hand for issue #671, as the factory's first end-to-end chained change (`add-spec-factory-runner` task 2.3). No task started.

## Next

Task 1.1, the Worker query and its real-SQL tenant-isolation test. Dispatched once, after the phase 2 factory PR (#696) is on `main`; task 2.1 should then start from 1.1's merge.

## Open PRs

- None.

## Waiting on the user

- Nothing.

## Learnings

- The `LEFT JOIN users u ON al.user_id = u.id` in `getDailyUsageReport` has no organisation condition today. Adding the name without scoping that join would let a cross-tenant `user_id` leak another organisation's username.
- `getItemsByUserReport` already names users with `COALESCE(u.username, u.email, 'Unknown')`; this change returns null instead of `'Unknown'` so the page owns the fallback wording.
