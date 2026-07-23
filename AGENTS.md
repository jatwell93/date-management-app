# AGENTS.md

**Monorepo development guide for AI-assisted work.**
Node/Express/TypeScript backend · React frontend · Cloudflare Workers · shared libs.
Neon PostgreSQL database · Clerk authentication · Sentry monitoring · Stripe payments.

**Last updated:** July 2026

---

## 1. Core Rules (non-negotiable)

- **Reuse before creating.** Search for an existing controller/service/repository/component before adding a new file. If you must add one, say why the existing code couldn't be extended.
- **Feature branches, never `main`.** All work on `feature/<change-id>` (or `fix/`, `chore/`).
- **Tests for what you touch.** No new behaviour without a test. Prefer writing the failing test first.
- **No secrets in code.** Never hardcode keys/passwords. Secrets come from env / Doppler.
- **No mock data in production paths.** Test fixtures are fine.
- **Cite code as `path/file.ts:42`** (or `:42-58` for a range) when referring to specific lines.
- **Track work in OpenSpec**, not ad-hoc markdown TODO files (see §5).
- **Use Context7** when you need up-to-date library/API documentation, setup or configuration steps without me having to explicitly ask.

---

## 2. Repository Layout

This is a monorepo. There is **no** root `src/` app — packages live in subfolders:

| Path | What it is |
| ---- | ---------- |
| `backend/` | Express/TypeScript API. Prisma (v6) + tsyringe DI + SWC. Layered: `backend/src/{routes,controllers,services,repositories,db,models,middleware}`. Tests in `backend/src/tests`. |
| `frontend/` | React (CRA) app. |
| `workers/` | Cloudflare Workers. Real-SQL tests via pglite (`npm run test:db`). |
| `shared/` | Code shared across packages (e.g. domain logic). |
| `e2e/` | Playwright end-to-end tests. |
| `docs/` | Operational and reference documentation. |
| `openspec/` | Change proposals and specs (see §5). |

**Backend layering** (keep it clean): `routes → controllers → services → repositories/db`.
Controllers coordinate HTTP; business logic lives in services; DB access lives in repositories. Use DI (tsyringe) rather than hardcoding dependencies. Use strict TypeScript — no unjustified `any`.

### Understanding structure quickly

Use **codemap** — scoped and diff-aware, generated on demand:

```bash
codemap --diff          # what changed vs main — best default for routine work
codemap backend         # scope to one package (backend | frontend | workers)
codemap .               # full map (~1,700 lines — only when you truly need it)
```

---

## 3. Session Startup

Every session: skim recent history with `git log -5 --oneline`, and check active work with `openspec list`. Load only the files your task touches — this repo is large; read on demand rather than up front.

For non-trivial changes, recall prior context: `node scripts/mem-recall.js "<keywords>"` (offline lexical search over `memory.jsonl`; skip for pure read-only/docs work, don't block if the index is missing).

---

## 4. Workflow

Agents are trusted to use judgment; there's no rigid state machine. The through-line is:

**Understand → (propose if non-trivial) → branch → build with tests → verify → get approval → commit/PR.**

- **Small/obvious fixes:** just make the change on a branch, add/adjust tests, run the gate (§6), and summarise.
- **Non-trivial or spec-affecting work:** open an OpenSpec proposal first (§5), get it approved, then implement.
- **Human gate before pushing:** present a short summary (what changed, tests run + result, anything risky). Push/PR only after the user approves.

Commits use conventional format, e.g. `feat(backend): add markdown resolver`. Include a `Refs: <change-id>` line when tied to an OpenSpec change.

---

## 5. OpenSpec (change tracking)

Use OpenSpec for all tracked change work — **no ad-hoc markdown TODO files, no planning docs in the repo root.**

```bash
openspec list                           # active changes + progress
openspec list --specs                   # current specs
openspec proposal <change-id>           # scaffold a new change
openspec validate <change-id> --strict  # validate formatting
openspec show <change-id>               # review proposal/tasks/deltas
openspec archive <change-id> --yes      # archive after all tasks complete + merged
```

Flow: `list` → `proposal` → edit `proposal.md` + `tasks.md` → `validate --strict` → implement tasks sequentially (checking `[x]`) → `archive`. Don't archive with incomplete tasks; don't skip `--strict` validation.

---

## 6. Quality Gate

Run the gate for the package(s) you changed. There is **no** root `npm test` / `npm run build` (the bare `npm test` errors on purpose).

```bash
# Component test gate (fast, diff-scoped — this is the minimum before commit)
npm run test:backend:diff        # backend changes
npm run test:frontend:diff       # frontend changes
npm run test:db                  # worker DB changes (pglite real-SQL)

# Fuller coverage run when warranted
npm run test:backend:coverage
npm run test:frontend:coverage

# Lint (root ESLint covers all packages) — must exit 0
npm run lint

# Type-check / build the affected component
npm run compile                  # root tsc
npm run build:frontend
npm run build:workers

# Validate OpenSpec if you touched a change
openspec validate --all
```

Notes:
- Backend tests: run via `doppler run -- npm test` when a real secret is needed; for logic gated on a secret being **unset**, also run without Doppler for CI parity.
- `doppler run -- cs delta` (CodeSense) is a separately authorized provider check, not part of the local loop.

---

## 7. Memory (Memvid)

Project knowledge — bugs, fixes, decisions, patterns — is stored in `memory.jsonl` (committed, append-only). `project-memory.mv2` is a **local, gitignored, rebuildable** search index derived from it.

```bash
node scripts/mem-recall.js "<query>"                 # recall before non-trivial work
node scripts/mem-log.js <KIND> "<title>" "<message>" # store as you work
npm run mem:rebuild                                   # rebuild local index after a fresh clone
```

`KIND` ∈ `FIX | PATTERN | DECISION | FEATURE | ERROR | ARCHITECTURE | WORKFLOW`.

**Store proactively** — don't wait to be asked — on: a bug fix (problem + solution), an architecture/design decision (choice + rationale), a reusable pattern, a completed feature, or a resolved error (message + fix).

### Search & Refactor: When to Use What

Pick the tool by the *question*, not by habit. For everyday "where is this string/symbol" lookups, `ripgrep` is the default and the fastest — reach for `mgrep` or `ast-grep` only when the question is genuinely semantic or structural.

| Scenario | Tool | Why |
| --- | --- | --- |
| "Find all uses of `verifyToken`" / "which files import `@clerk/backend`" | `ripgrep` (the built-in Grep tool) | **Default choice — literal / symbol search.** Sub-second; honours `.gitignore` so vendored deps are skipped automatically. Prefer this for confirming whether/where something is used. |
| "Find files with a `console.log`" | `ripgrep` | **Simple pattern matching:** fast, literal, line-by-line regex. |
| "How is markdown-matrix pricing implemented?" | `mgrep` | **Semantic search:** finds code by intent when you don't know the exact identifier. Index-backed and returns *ranked* relevance (top matches), not every literal hit — trades a few seconds of query time for not having to know the search term. |
| "Where does auth/session handling live?" | `mgrep` | **Conceptual search:** locate architectural components with a natural-language query. |
| "Rename `unwrap()` → `expect()` everywhere" / "change every `useState(x)` call shape" | `ast-grep` | **Structural refactor:** understands the AST for safe, syntax-aware edits. **Always scope it to source paths** (e.g. `backend/src frontend/src workers/src shared`) — an unscoped run parses every file in the tree, including vendored deps, and will crawl. |

**Rule of thumb:** default to `ripgrep`; use `mgrep` when you don't know the exact term; use `ast-grep` only for structural rewrites, and always give it explicit source paths.

## Serena Tool Usage  
  
This project uses Serena for semantic code operations. When working on code files:  
  
**PRIORITY**: Use Serena's symbolic tools instead of basic file operations:  
- For code structure overview: `get_symbols_overview`  
- For reading symbol bodies: `find_symbol` with `include_body=true`  
- For finding references: `find_referencing_symbols`  
- For editing code: `replace_symbol_body`, `insert_before_symbol`, `insert_after_symbol`, or `replace_content`  
  
**AVOID** using basic `read_file`, `grep`, or line-based `edit` tools on code files when Serena equivalents exist. Serena's tools are more token-efficient and maintain semantic correctness.  
  
Before editing code: 1) Get symbol overview, 2) Read specific symbols needed, 3) Use Serena editing tools.
