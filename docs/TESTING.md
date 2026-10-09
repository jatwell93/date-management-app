### 1. **Testing the Worker API and Database**

Run these from the **root** folder:

- **Run the real-SQL suite (pglite, against the authoritative migrations)**:
  ```bash
  npm run test:db
  ```
- **Run the migration runner tests**:
  ```bash
  npm run test:migrations
  ```
- **Run the operator-tool tests**:
  ```bash
  npm run test:operations
  ```
- **Type-check the Worker, including test files (CI runs this)**:
  ```bash
  (cd workers && npm run typecheck)
  ```
- **Running manually in the workers directory**:
  ```bash
  cd workers
  npm test                # Unit and handler tests (vitest)
  npm run test:coverage   # With coverage
  ```

There is no root `npm test`; it errors by design. Do not run `npm run test:prod` or `npm run test:both`: they target the production database.

### 2. **Testing Frontend**

Run these from the **root** folder:

- **Run all frontend tests with coverage**:
  ```bash
  npm run test:frontend:coverage
  ```
- **Run only changed frontend tests (vs `main`)**:
  ```bash
  npm run test:frontend:diff
  ```
- **Running manually in frontend directory**:
  ```bash
  cd frontend
  npm run test:coverage   # Full suite
  npm run test:diff       # Changed files only
  ```

### 3. **Testing Changes Only (Quick Feedback)**

These commands are optimized for checking _only_ the code you are currently working on.

- **Worker and database changes**:
  ```bash
  npm run test:db
  ```
- **Frontend Changes**:
  ```bash
  npm run test:frontend:diff
  ```
- **Ultimate Bug Scanner (Code Analysis)**:
  Run `ubs` on your changed files to catch potential bugs before committing.
  ```bash
  ubs $(git diff --name-only)
  ```

### Summary Table

| Scope            | Action                | Command (from Root)                 |
| :--------------- | :-------------------- | :---------------------------------- |
| **Worker / DB**  | Real-SQL suite        | `npm run test:db`                   |
| **Worker**       | Type-check with tests | `(cd workers && npm run typecheck)` |
| **Migrations**   | Runner tests          | `npm run test:migrations`           |
| **Frontend**     | Full Suite + Coverage | `npm run test:frontend:coverage`    |
| **Frontend**     | **Changes Only**      | `npm run test:frontend:diff`        |
| **Code Quality** | Scan Changed Files    | `ubs $(git diff --name-only)`       |
