---
name: delegate
description: >-
  Hand a bounded OpenSpec task group to the Devin CLI (free GLM-5.2 tier) as the
  implementer, then run the repo quality gate, review the diff, and drive fix rounds
  until it passes. Use when the user says "delegate", "hand this to Devin", "outsource
  this task", "/delegate <change-id> <group>", or asks for an OpenSpec task group to be
  implemented by the cheaper external agent instead of inline. Do NOT use for tasks small
  enough to just do inline, for anything touching secrets/deploys/external services, or
  when the user wants the code written by Claude directly.
---

# Delegate to Devin

Devin (`devin.exe`, already installed and authenticated as Josh Atwell) is the
**implementer**. You are the **orchestrator and reviewer**. The user owns the merge.

The division of labour is fixed:

| Who | Does |
| --- | --- |
| **Devin** | Writes code inside the repo. Nothing else. |
| **You** | Task brief, quality gate, diff review, fix rounds, task ticking, local commit. |
| **User** | Push, PR, merge, anything touching an external service. |

## Non-negotiables

1. **Pin `--model glm-5-2`.** That exact string is the free 200K tier. The neighbouring
   ids (`glm-5-2-max`, `glm-5-2-1m`, `glm-5-2-max-1m`, `glm-5-2-none`, `glm-5-2-none-1m`)
   all bill at USD 0.7 in / 2.2 out per MTok. Never pass the bare family alias `glm-5.2` — it can
   resolve to a paid variant. Re-check with `devin models list` if a run looks unexpectedly billed.
2. **Never run Devin under Doppler.** `doppler run -- devin ...` would inject live
   `STRIPE_SECRET_KEY`, prod R2 credentials and database URLs into a third-party agent's
   environment. Devin writes the code; **you** run the secret-bearing tests. No exceptions.
3. **`--permission-mode smart`.** Auto-approves workspace edits plus commands a fast model
   judges safe, so Devin can run `npm test`/`lint` and fix its own failures before handing
   back. This is only acceptable because `.devin/hooks.v1.json` bridges `dcg` into Devin's
   `exec` tool — the repo's `dcg` PreToolUse hook in `.claude/settings.json` guards *your*
   Bash calls only, never tools run inside a Devin subprocess. **If `.devin/hooks.v1.json`
   is missing from the working tree, or `pwsh`/`dcg` is not on `PATH`, drop back to
   `accept-edits`** — the wrapper fails open, so a missing guard is silent.
   Never `dangerous`.

   Under `accept-edits` Devin cannot run any command: it exits 0 having verified nothing
   ("rejected a tool call that requires confirmation"). Treat that exit code as "session
   ended", never as "work is good".
4. **Devin never touches the outside world.** No `git push`, `gh`, `doppler`, `wrangler`,
   `npx prisma migrate deploy`, no deploys. State this in every brief.
5. **Never push, open a PR, or merge.** Stop and report. That gate is the user's.

## Choosing the unit of work

One Devin session = **roughly 1–3 hours of work that fits in 200K context**. Usually that's
a `## N.` group heading, but not always: in `retire-express-unify-on-postgres` a heading is
an entire *Phase* (1.1–1.11), far too big. There, the unit is a **single numbered task**
(`/delegate <change-id> 1.8`). Judge by size, not by heading depth.

**Screen the task before delegating.** Many tasks in this repo are operator-driven, not
code — they run `neonctl`, `wrangler deploy`, `psql` against real Neon branches, or ask
you to confirm a setting in a vendor console. Those are **not delegatable** and must stay
with Claude + the user, regardless of which phase they sit in. Read the task text and
check for external-service verbs before starting. If a task is *mixed* (code plus a
console check), delegate only the code portion and say so explicitly in the report.

## Procedure

### 1. Preflight

```bash
git status --porcelain          # must be clean; if not, STOP and ask
openspec show <change-id>       # confirm the change and read the group's tasks
devin auth status               # confirm still logged in
```

If the tree is dirty, stop — Devin edits in place on your live working tree, so
uncommitted work would get tangled with its output.

Create or switch to the branch (never `main`, per `AGENTS.md` §1):

```bash
git switch -c feature/<change-id>   # or: git switch feature/<change-id> if it exists
```

### 2. Build the brief

Devin **already auto-loads `AGENTS.md` and `CLAUDE.md`** as always-on rules (verify with
`devin rules list`). Do **not** restate repo conventions, layering, the gate commands, or
the branch policy — it has them, and every restated line burns free-tier context.

Write the brief to the scratchpad, not an inline shell string:

`<scratchpad>/delegate-<change-id>-<group>-brief.md`

Include only:

- The change id and the **verbatim task lines** for that group from `tasks.md`.
- Specific existing files to extend (cite as `path/file.ts:42`) — you know the codebase
  better than a cold session does, and this is where you add the most value. Use `mgrep`
  or Serena to find them first.
- Anything the tasks.md wording leaves genuinely ambiguous, resolved.
- The prohibition block:

  ```
  Do not run: git push, git commit, gh, doppler, wrangler, prisma migrate deploy,
  or any deploy/network-mutating command. Do not modify files outside this task group.
  Do not edit openspec/ — the orchestrator ticks the checkboxes.
  Implement and test only.
  ```

Keep it tight. A good brief is 20-60 lines.

### 3. Invoke Devin

```bash
devin --prompt-file "<brief-path>" -p \
  --model glm-5-2 \
  --permission-mode smart \
  --export "<scratchpad>/delegate-<change-id>-<group>-transcript.md"
```

- **Run with `run_in_background: true`.** A task group routinely exceeds the Bash tool's
  10-minute ceiling; a foreground call would time out and orphan a live agent. Wait for
  the completion notification.
- If it fails with a workspace-trust error (print mode can't show the trust prompt), add
  `--respect-workspace-trust false`.
- Don't parse stdout for structure — there's no `--output-format json`. The transcript is
  for audit only. **`git diff` and the gate's exit code are the source of truth**: they
  measure what Devin did, not what it claims it did.

### 4. Run the gate — you, not Devin

Map changed paths to gates (`AGENTS.md` §6). There is no root `npm test`/`npm run build`.

```bash
git diff --name-only main...HEAD    # or: git status --porcelain for uncommitted work
```

| Changed | Gate |
| --- | --- |
| `backend/**` | `doppler run -- npm run test:backend:diff` |
| `frontend/**` | `npm run test:frontend:diff` |
| `workers/**`, `shared/**` | `npm run test:db` |
| `src/database/migrations/**`, `database/migrations/**` | `npm run test:migrations` (root `src/` — the Postgres runner. `node:test`, compiles first, no Doppler needed) |
| any | `npx eslint <changed files>` (must exit 0) — **not** `npm run lint`, see below |
| `openspec/**` | `openspec validate <change-id> --strict` |

**The local gate is not the whole gate.** Some suites only run in CI because they need a
live service — `npm run test:migrations:e2e` needs a real Postgres and is *not* part of
`test:migrations`. When a change tightens a shared schema or validator, grep for every
in-repo construction site of that shape (fixtures and temp manifests included), not just
the ones the local gate compiles. Task 1.8 shipped green locally and failed CI because
`e2e.test.ts` builds a synthetic manifest entry that the new required fields invalidated.

Doppler notes (both are real, previously-hit failure modes):

- Backend tests run **without** Doppler bleed `.env.production` R2 config and produce a
  false storage-factory failure — so use `doppler run --` for the normal backend run.
- If the change is gated on a secret being **unset**, *also* run that test **without**
  Doppler for CI parity. Doppler injects real secrets that mask env-absence bugs.

### 5. Review the diff yourself

The gate passing is necessary, not sufficient. Read `git diff` against `AGENTS.md`:

- **Reuse before creating** — did it add a file where an existing service/controller/
  component should have been extended? This is the most common GLM failure mode.
- **Backend layering** — `routes → controllers → services → repositories/db`. Business
  logic in services, DB access in repositories, tsyringe DI not hardcoded deps.
- **Tests exist** for the new behaviour, and actually assert something.
- **No unjustified `any`**, no hardcoded secrets, no mock data in production paths.
- Scope — nothing edited outside the task group.

### 6. Fix rounds — max 3

Resume the same session so it keeps file context (cheaper and more accurate than a cold
re-brief):

```bash
devin -c -p "$(cat <scratchpad>/delegate-<change-id>-fix-<n>.md)"
```

Write each fix request to a file the same way. Be specific: paste the failing test output
verbatim and cite `path/file.ts:42`. Vague fix requests waste rounds.

Re-run the gate after each round. **After 3 failed rounds, STOP.** Report to the user:
what still fails, the verbatim output, and — importantly — your read on whether the
*code* is wrong or the *spec* is wrong. Three rounds of failure on a clear brief usually
means the tasks.md is underspecified, which is the user's call to make, not a thing to
grind more tokens against.

Also stop early, without burning rounds, if Devin has done something structurally wrong
(edited outside scope, deleted tests, hardcoded a secret). Re-briefing beats correcting.

### 7. Land it locally and report

Once the gate passes and the diff survives review:

1. Tick the completed `- [ ]` → `- [x]` boxes in `openspec/changes/<change-id>/tasks.md`.
   **You** do this — Devin is told not to touch `openspec/`.
2. `openspec validate <change-id> --strict`
3. Commit locally on the feature branch — conventional format plus a `Refs:` line:
   ```
   feat(frontend): add hardware scan hook

   Refs: <change-id>
   ```
   Local commits are reversible and make each group independently reviewable.
   **Do not push and do not open a PR.**
4. Log to project memory if a durable lesson emerged:
   `node scripts/mem-log.js PATTERN "<title>" "<message>"`
5. Report to the user:
   - What Devin implemented, cited as `path/file.ts:42`
   - Gate results (which gates, pass/fail)
   - **What you pushed back on** across the fix rounds — this is the signal about whether
     delegation is actually paying off
   - Rounds used, and the next unchecked group

## When not to use this

- The task is small enough to just do inline — the delegation overhead exceeds the work.
- Anything touching secrets, migrations against a real database, deploys, or external
  services. Those stay with you and the user.
- The user asked for *your* implementation specifically.
- `git status` is dirty, or `devin auth status` shows logged out.
