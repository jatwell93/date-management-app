## 1. Discovery

- [ ] 1.1 Identify and confirm high-merit UBS critical and warning items to address.
- [ ] 1.2 Verify .env files are untracked and .env.example files contain no secrets.

## 2. Critical Fixes

- [ ] 2.1 Remove unsafe secret fallbacks and require env vars at startup (backend).
- [ ] 2.2 Remove unsafe secret fallbacks and require env vars at startup (workers).

## 3. Warning Fixes

- [ ] 3.1 Fix vetted unsafe JSON parsing and missing try/catch where applicable.
- [ ] 3.2 Fix vetted timer cleanup issues (setInterval/timeout) if confirmed.

## 4. Verification

- [ ] 4.1 Run targeted tests for affected areas.
- [ ] 4.2 Re-run UBS scan on affected paths and review results.
