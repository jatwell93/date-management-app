### 1. **Testing Backend**
Run these from the **root** folder:

*   **Run all backend tests with coverage**:
    ```bash
    npm run test:backend:coverage
    ```
*   **Run only changed backend tests (vs `main`)**:
    ```bash
    npm run test:backend:diff
    ```
*   **Running manually in backend directory**:
    ```bash
    cd backend
    npm run test:coverage   # Full suite
    npm run test:diff       # Changed files only
    ```

### 2. **Testing Frontend**
Run these from the **root** folder:

*   **Run all frontend tests with coverage**:
    ```bash
    npm run test:frontend:coverage
    ```
*   **Run only changed frontend tests (vs `main`)**:
    ```bash
    npm run test:frontend:diff
    ```
*   **Running manually in frontend directory**:
    ```bash
    cd frontend
    npm run test:coverage   # Full suite
    npm run test:diff       # Changed files only
    ```

### 3. **Testing Changes Only (Quick Feedback)**
These commands are optimized for checking *only* the code you are currently working on.

*   **Backend Changes**:
    ```bash
    npm run test:backend:diff
    ```
*   **Frontend Changes**:
    ```bash
    npm run test:frontend:diff
    ```
*   **Ultimate Bug Scanner (Code Analysis)**:
    Run `ubs` on your changed files to catch potential bugs before committing.
    ```bash
    ubs $(git diff --name-only)
    ```

### Summary Table

| Scope | Action | Command (from Root) |
| :--- | :--- | :--- |
| **Backend** | Full Suite + Coverage | `npm run test:backend:coverage` |
| **Backend** | **Changes Only** | `npm run test:backend:diff` |
| **Frontend** | Full Suite + Coverage | `npm run test:frontend:coverage` |
| **Frontend** | **Changes Only** | `npm run test:frontend:diff` |
| **Code Quality** | Scan Changed Files | `ubs $(git diff --name-only)` |