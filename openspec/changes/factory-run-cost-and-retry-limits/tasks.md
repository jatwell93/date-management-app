# Tasks: Cap factory run spend and ride out API capacity errors

Built in an interactive session: the task touches a `no_go` path (`.github/workflows/factory.yml`).

## 1. Runner limits

- [x] 1.1 The "Run Claude" step in `.github/workflows/factory.yml` adds `--max-budget-usd 20` to `claude_args` and sets `CLAUDE_CODE_RETRY_WATCHDOG: '1'` and `CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS: '600000'` in the step's `env`. A comment in the workflow cites why the wait is bounded and that the cap is an untuned first value. `scripts/factory-workflows.test.js` asserts the exact flag, both variables and that the wait is below the step timeout.
      Demo: the workflow shows the three settings, and the next factory run starts and finishes without an argument error from the flag.
      Acceptance: `npm run test:tooling` passes, with the new assertion mutation-verified (remove each setting, the test fails); `node scripts/check-no-go.js --change factory-run-cost-and-retry-limits` lists only the workflow; the first factory run after merge completes, and its log shows the step accepted `--max-budget-usd`.
