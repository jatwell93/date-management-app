# Proposal: Cap factory run spend and ride out API capacity errors

## Why

The factory's Claude step (`.github/workflows/factory.yml`, "Run Claude") is bounded by `--max-turns 200` and `timeout-minutes: 80`. Neither limits spend, so a run that loops on large tool output could cost far more than a normal task before a limit trips. The runner also has no setting for transient API capacity errors (`429`, `529`). By default Claude Code gives up after a fixed number of retries, the step fails, and the factory spends its one retry (`factory-retry`) on an outage rather than on a real fault.

The Claude Code documentation covers both:

- `--max-budget-usd` stops a print-mode run when its client-side cost estimate reaches the amount. Subagent spend counts. Spend can pass the cap, so it needs headroom. Once reached, the run ends with an error (https://code.claude.com/docs/en/cli-reference).
- `CLAUDE_CODE_RETRY_WATCHDOG=1` retries `429` and `529` errors instead of failing after `CLAUDE_CODE_MAX_RETRIES`, and backs off up to 5 minutes. It fails at once on a spend-limit `429`. `CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS` bounds how long one request waits; unset, the wait has no limit (https://code.claude.com/docs/en/errors, https://code.claude.com/docs/en/env-vars).

Past run logs record no cost, so the cap cannot be calibrated from history. The first value is a generous guess to catch runaway runs, to be tuned.

## What changes

- `claude_args` in the "Run Claude" step gains `--max-budget-usd 20`.
- The same step sets `CLAUDE_CODE_RETRY_WATCHDOG: '1'` and `CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS: '600000'` (10 minutes per request). Without the bound, a capacity outage could hold a run until the 80-minute step timeout.
- A run that ends on the budget cap or on a wait that ran out fails the step as any other failure does. The report job records it for the existing single retry, and a failed retry escalates.
- The `agent-factory-runner` spec records the spend cap and the retry behaviour.

## Out of scope

- Changing `--max-turns`, the step timeout, the allowlist or the denylist.
- Pinning actions to commit SHAs, and any sandbox setting.
- Reporting spend in the factory digest. The first run after this change shows whether the action's output exposes cost.

## Autonomy

```yaml
merge: human
```

The task edits `.github/workflows/factory.yml`, on the `no_go` baseline (`scripts/check-no-go.js`), so it is built in an interactive session.
