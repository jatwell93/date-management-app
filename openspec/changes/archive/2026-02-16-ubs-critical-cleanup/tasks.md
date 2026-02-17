## 1. Discovery

- [x] 1.1 Identify and confirm high-merit UBS critical and warning items to address.
- [x] 1.2 Verify .env files are untracked and .env.example files contain no secrets.

## 2. Critical Fixes

- [x] 2.1 Remove unsafe secret fallbacks and require env vars at startup (backend).
- [x] 2.2 Remove unsafe secret fallbacks and require env vars at startup (workers).

## 3. Warning Fixes

- [x] 3.1 Fix vetted unsafe JSON parsing and missing try/catch where applicable.
- [x] 3.2 Fix vetted timer cleanup issues (setInterval/timeout) if confirmed.

## 4. Verification

- [x] 4.1 Run targeted tests for affected areas.
- [x] 4.2 Re-run UBS scan on affected paths and review results.
