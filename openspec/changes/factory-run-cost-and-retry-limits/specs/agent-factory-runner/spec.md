## ADDED Requirements

### Requirement: A factory run has a spend cap and waits out API capacity errors for a bounded time

The factory's Claude step SHALL stop when its estimated spend reaches a fixed cap, set with `--max-budget-usd` in `claude_args`. The step SHALL set `CLAUDE_CODE_RETRY_WATCHDOG` to `1` so that `429` and `529` capacity errors are retried, and SHALL set `CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS` so that one request cannot wait until the step timeout. A run that ends on the cap or on an exhausted wait SHALL fail the step, so the existing one-retry rule and escalation apply to it.

#### Scenario: Run reaches the spend cap

- **GIVEN** a factory task run whose estimated spend reaches the cap
- **WHEN** Claude Code stops the run
- **THEN** the Claude step fails
- **AND** the report job labels the tracking issue `factory-retry` as it does for any failed run

#### Scenario: API returns capacity errors

- **GIVEN** a factory run that receives `529` errors from the API
- **WHEN** the errors clear within the bounded wait
- **THEN** the run continues without failing the step
- **AND** if they do not clear within the bounded wait, the step fails and the one-retry rule applies
