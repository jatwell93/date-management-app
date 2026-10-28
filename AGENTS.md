# AGENTS.md

**Monorepo development guide for AI-assisted work.**
TypeScript Cloudflare Workers API · React frontend · shared libs.
Neon PostgreSQL database · Clerk authentication · Sentry monitoring · Stripe payments.

**Last updated:** October 2026

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

| Path        | What it is                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `frontend/` | React (Vite) app.                                                                                             |
| `workers/`  | Cloudflare Workers, the deployed API (`src/index-minimal.ts`). Real-SQL tests via pglite (`npm run test:db`). |
| `shared/`   | Code shared across packages (e.g. domain logic).                                                              |
| `e2e/`      | Playwright end-to-end tests.                                                                                  |
| `docs/`     | Operational and reference documentation.                                                                      |
| `openspec/` | Change proposals and specs (see §5).                                                                          |

**Express is retired** (OpenSpec `retire-express-unify-on-postgres`): the API is `workers/` on Neon Postgres, and `backend/` no longer exists. The last Express revision is the tag `express-sqlite-last`; `docs/express-retirement-recovery.md` says how to read or restore it. Use strict TypeScript — no unjustified `any`.

---

## 3. Session Startup

Every session: skim recent history with `git log -5 --oneline`, and check active work with `openspec list`. Load only the files your task touches — this repo is large; read on demand rather than up front.

For non-trivial changes, recall prior context: `node scripts/mem-recall.js "<keywords>"` (offline lexical search over `memory.jsonl`; skip for pure read-only/docs work, don't block if the index is missing).

---

## 4. Workflow

Agents are trusted to use judgment; there's no rigid state machine. The through-line is:

**Understand → (propose if non-trivial) → branch → build with tests → verify → push + PR → babysit → user merges.**

- **Small/obvious fixes:** just make the change on a branch, add/adjust tests, run the gate (§6), and summarise.
- **Non-trivial or spec-affecting work:** open an OpenSpec proposal first (§5), get it approved, then implement.
- **Push and open the PR yourself** once the gate passes on a `feature/*`, `fix/*` or `chore/*` branch. No approval needed. Put the summary (what changed, tests run + result, anything risky) in the PR body.
- **Then run the `babysit-pr` skill** until CI is green and bot reviews are handled. Never ask the user to paste bot comments or CI logs.
- **The human gate is the merge.** Do not merge, approve or enable auto-merge, whatever the change's `merge` setting says (§5). Never push to `main`.
- **After a merge:** `node scripts/cleanup-merged.js` deletes merged branches and worktrees and moves you onto an up-to-date `main`.
- Write scratch files with the Write tool, not `cat > "$VAR/file"`: `dcg` blocks shell redirects to variable paths.

Commits use conventional format, e.g. `feat(workers): add markdown resolver`. Include a `Refs: <change-id>` line when tied to an OpenSpec change.

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

- **Handover:** each active change keeps `openspec/changes/<id>/handover.md` (state, next task, open PRs, decisions waiting on the user). Update it with the `handover` skill when a task merges or a session ends; start the next session with `/resume <id>`. It replaces pasted handover prompts.
- **Autonomy:** `proposal.md` may carry an `## Autonomy` section (a fenced `yaml` block) with `merge: auto` or `merge: human` (default), an optional `issue: N` and an optional `no_go` list. No agent merges, whatever `merge` says: every merge to `main` deploys production, so the owner merges. Migrations, billing, auth and anything touching production data stay `merge: human`.

### Factory (unattended runs)

`.github/workflows/factory.yml` runs one task of a change per run in the cloud (`run-spec` skill), opens a PR labelled `factory:<id>`, and babysits it. Start it with `gh workflow run factory.yml -f change_id=<id>`. Each merged factory PR starts the next unchecked task; the owner merges each one.

- **Change id:** at most 42 characters, because every PR and tracking issue carries the label `factory:<id>` and GitHub caps labels at 50.
- **`no_go`:** paths the factory must not edit. A fixed baseline always applies: workflows, migrations, the backup script, the agent's own rules (`.claude/**`, `AGENTS.md`, `CLAUDE.md`), the lint gates and the factory's own scripts. The authoritative list is `BASELINE` in `scripts/check-no-go.js`. A change's own entries add to it. The required `factory/no-go-guard` check fails a factory PR that touches one. A task that needs such a path, a product decision or operator access escalates instead.
- **Tracking issue:** the open issue labelled `factory:<id>`, else the `issue:` key of the Autonomy block (write it for a change that answers an existing issue, so the factory reports there), else a new one (`node scripts/factory-issue.js <id>` prints it).
- **Escalation:** the factory comments on the tracking issue, adds `needs-human` and stops. No Claude run of the change starts while that label is on, babysit passes included. Answer in a comment, then remove the label yourself to resume; the next run records the answer in `handover.md`. To hold a change by hand, add `needs-human` to its tracking issue.
- **Owner tasks:** write a task as `- [ ] 2.3 (owner) ...` when it needs a `no_go` path, a vendor console or production access. The router never gives it to Claude: it escalates instead (`scripts/factory-escalate.js`). Tick it on `main`, then remove `needs-human`; the next task starts.
- **Retry once:** a Claude run that fails (not one that is cancelled) labels the tracking issue `factory-retry` with the run link (`scripts/factory-retry.js`). An hourly `schedule` on `factory.yml` retries it once, at least an hour later, as a babysit pass when a factory PR is open, else as a task. A failed retry escalates with both run links. GitHub delays or skips `schedule` runs under load, so a retry can come hours later. The Claude step's `timeout-minutes` stays below the job's, so a timeout fails the run instead of cancelling it.
- **One PR per change:** add `pr: per-change` to the Autonomy block and every task lands on one PR, which you merge once. The first task opens it titled `WIP:` (not a draft: Seer and Copilot skip drafts). Each event on it advances it one step: a babysit pass, else (once settled) the next task on the same branch, else the router drops `WIP:` and mentions you. Its merge starts nothing; merge it before `WIP:` is dropped and the next task opens a new per-change PR. An hourly sweep (`scripts/factory-sweep.js`) moves on a PR that has a step to take but no event; GitHub can skip `schedule` runs for hours, so a settled PR may wait that long. Escalations put `needs-human` on the tracking issue only; tick an `(owner)` task in the PR branch's `tasks.md`. Copilot reviews only the first push (the `main` ruleset's `review_on_push` is off). If GitHub says the branch is out of date, use "Update branch" before merging.
- **Digest:** `.github/workflows/factory-digest.yml` comments daily on the `Factory digest` issue with what waits on the owner, open factory PRs and failed runs; it posts nothing when all are empty.

---

## 6. Quality Gate

Run the gate for the package(s) you changed. There is **no** root `npm test` / `npm run build` (the bare `npm test` errors on purpose).

```bash
# Component test gate (fast, diff-scoped — this is the minimum before commit)
npm run test:frontend:diff       # frontend changes
npm run test:db                  # worker DB changes (pglite real-SQL)
(cd workers && npm run typecheck)  # CI type-checks workers including test files; plain tsc --noEmit does not
npm run test:operations          # when you touch src/operations

# Fuller coverage run when warranted
npm run test:frontend:coverage

# Lint (root ESLint covers all packages) — must exit 0
npm run lint

# Type-check / build the affected component
npm run compile                  # root tsc
npm run build:frontend
npm run build:workers

# Validate OpenSpec if you touched a change
openspec validate --all

# Use open-code-review as a final check before completion
ocr review --from main --to feature-branch --format json --audience agent --background <context about changes made>
# --background is one of the highest-leverage flags for review quality — always pass the requirement / PR description when invoking
```

Notes:

- Tests that need a real secret run via `doppler run --`; for logic gated on a secret being **unset**, also run without Doppler for CI parity.
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

**Capture rules** (every agent, any tool — hooks only help Claude Code):

- **Before opening a PR** that changes behavior, log one entry (`FIX`, `PATTERN` or `DECISION`), or state in the PR "Lesson logged: none, because …".
- **Before `/compact` or ending a long session**, log one `WORKFLOW` checkpoint: current state, next step, and any open risk. It is the handoff for the next session or the next tool.
- **`memory.jsonl` is committed to a public repository.** Never log secrets, customer or organization data, production hostnames, or unfixed-vulnerability detail. `scripts/mem-log.js` rejects obvious secret patterns (`scripts/mem-redact.js`); it cannot judge prose, so you must.
- Claude's per-machine auto-memory is a private cache, not the shared record. A lesson that matters on another machine or tool belongs here.

### Search & Refactor

- Search with `ripgrep` (the Grep tool). Edit with the native `Edit`/`Write` tools.
- Structural rewrites: `ast-grep`, always scoped to source paths (`frontend/src workers/src shared`); an unscoped run parses vendored deps and crawls.
