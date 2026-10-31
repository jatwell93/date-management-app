# Factory guide

How a change goes from an idea to merged code with you giving input only at the start and at each merge. Read this when you have not used the process for a while. The full rules are in `AGENTS.md` ("Factory").

## The funnel

```
 PLAN  (you, in a session with Claude)
 ┌──────────────────────────────────────────────────────────────┐
 │ 1. Write the change       proposal.md + spec deltas          │
 │                           openspec validate <id> --strict    │
 │ 2. /to-tickets <id>       answer the quiz on the slices      │
 │                           -> tasks.md, a tracking issue,     │
 │                              one ticket per task, a plan PR  │
 │ 3. Merge the plan PR      this is the "go"                   │
 └──────────────────────────────────────────────────────────────┘
                              │
 BUILD  (the factory, in GitHub Actions; no session needed)
 ┌──────────────────────────────────────────────────────────────┐
 │ 4. Task 1 -> PR           CI and bot reviews are handled     │
 │ 5. Next task              you merge, or the PR carries on    │
 │ 6. No task left           the factory archives the change    │
 └──────────────────────────────────────────────────────────────┘
                              │
 FINISH  (you)
 ┌──────────────────────────────────────────────────────────────┐
 │ 7. Merge the last PR      the tickets and tracking issue     │
 │                           close by themselves                │
 └──────────────────────────────────────────────────────────────┘
```

## Your part, in order

1. **Plan.** Ask Claude for the change. It needs `proposal.md` with an `## Autonomy` block (see below), spec deltas in `specs/`, and a passing `openspec validate <id> --strict`. The change id is at most 42 characters.
2. **Slice.** Run `/to-tickets <id>`. Claude proposes the tasks, each with a demo and what blocks it. Say whether the slices are too big or too small. Nothing is written until you approve.
3. **Go.** Merge the plan PR. It carries the labels `factory:<id>` and `factory-ready`; that merge starts task 1. You do not dispatch anything.
4. **Merge each factory PR** when it is green and reviewed. How many PRs there are depends on the `pr:` key:
   - **`pr: per-change`** (best for small, related tasks): one PR for the whole change. Its title starts with `WIP:` while tasks are still landing. **Do not merge it until `WIP:` is gone and the factory has mentioned you.** The factory archives the change on that PR before it asks.
   - **No key** (one PR per task): merge each PR; the merge starts the next task. When none is left, the factory opens one more PR that archives the change.
5. **Done** when the last PR is merged. The tickets and the tracking issue close with it.

## The Autonomy block

In `proposal.md`:

````markdown
## Autonomy

```yaml
merge: human
pr: per-change
no_go:
  - some/extra/path/**
```
````

`merge: human` is the only value in use: you always merge. `no_go` adds paths to the ones the factory may never edit.

## What the factory will not do

It never merges, never touches production, and never edits the protected paths: workflows, migrations, the backup script, the agent's own rules (`.claude/**`, `AGENTS.md`, `CLAUDE.md`), the lint gates and the factory's own scripts. The list is `BASELINE` in `scripts/check-no-go.js`; run `node scripts/check-no-go.js --change <id>` to see it for one change.

A task that needs a protected path, a vendor console, or production access is an **owner task**: write it `- [ ] 2.3 (owner) ...`. The factory stops there and asks you. Anything that needs a migration ends up this way, because `database/migrations/**` is protected. Billing, auth and production-data work is also best planned as owner tasks.

## When it stops

| What you see | What it means | What to do |
|---|---|---|
| A comment from the factory that mentions you, and `needs-human` on the tracking issue | It hit a question it should not guess | Answer in a comment, then **remove the `needs-human` label** |
| `factory-retry` on the tracking issue | A run failed; one retry is queued | Wait. A second failure escalates with both run links |
| Nothing happens for hours | The hourly check (`schedule`) is late; GitHub delays it | Wait. Check state with `node scripts/pr-feedback.js <pr>` |
| An owner task is next | The factory escalated it on purpose | Do it, tick it in `tasks.md`, remove `needs-human` |
| "Branch is out of date" on a PR | `main` moved on | Use "Update branch", then merge |

To pause a change on purpose, add `needs-human` to its tracking issue. To start one without the plan-PR merge, `gh workflow run factory.yml -f change_id=<id>`.

## Where things live

| Thing | Where |
|---|---|
| The plan and the tasks | `openspec/changes/<id>/` (`proposal.md`, `tasks.md`, `handover.md`) |
| The tracking issue | The open issue labelled `factory:<id>` |
| One ticket per task | Sub-issues of the tracking issue |
| What the factory is allowed to do | `.claude/skills/run-spec/SKILL.md` |
| Progress of a PR | `node scripts/pr-feedback.js <pr> --summary` |
| Finished changes | `openspec/changes/archive/` |

## Related

- `AGENTS.md`: the full factory rules (escalation, retries, `no_go`).
- `.claude/skills/to-tickets/SKILL.md`: how the slicing and the quiz work.
- `openspec/specs/agent-factory-runner/spec.md`: what the factory promises.
