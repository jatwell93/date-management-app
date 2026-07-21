# CLAUDE.md

**Read `AGENTS.md` for the full working guide** (repo layout, workflow, OpenSpec, quality gate, memory).

Quick non-negotiables:

- Work on a `feature/*` branch, never `main`.
- Reuse existing code before adding files; cite lines as `path/file.ts:42`.
- Add/adjust tests for what you touch. Never commit secrets.
- Before committing, run the diff-scoped gate for the package you changed:
  `npm run test:backend:diff` / `test:frontend:diff` / `npm run test:db`, plus `npm run lint`.
  (There is no root `npm test` / `npm run build` — it errors by design.)
- Track non-trivial work in OpenSpec (`openspec list`); no ad-hoc TODO/planning files.
- This is a monorepo: code lives in `backend/`, `frontend/`, `workers/`, `shared/` — there is no root `src/` app.
