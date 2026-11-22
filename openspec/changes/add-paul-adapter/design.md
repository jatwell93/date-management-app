# Design: PAUL adapter

Decisions for task 1.1. Each answers a gap listed in section 4 of `extract-software-factory/design.md`. Formats were read on 2026-11-23 from `ChristopherKahler/paul` through `gh api` (`src/templates/{ROADMAP,PLAN,STATE,milestone-archive}.md`, `src/workflows/{complete-milestone,unify-phase}.md`); nothing was installed or run. A "yes" means the format carries the data, not that a PAUL project was tried (that is task 1.3).

## Layout the adapter reads

```
.paul/ROADMAP.md                                  phases and plan checkboxes
.paul/phases/<NN-slug>/<NN-NN>-PLAN.md            one per plan, YAML frontmatter
.paul/phases/<NN-slug>/<NN-NN>-SUMMARY.md         written by PAUL's close step
.paul/milestones/*.md                             archives of shipped milestones
```

A phase is `### Phase N: Name` in `ROADMAP.md`; a plan is a line `- [ ] NN-NN: description` under its `**Plans:**`. Decimal phases (`2.1`, plan `02.1-01`) are urgent insertions.

## Decisions

### Ids

- **Change id = the phase directory's slug**, without its number: `.paul/phases/01-fix-one/` is the change `fix-one`. It already fits the id rule (lowercase letters, digits, hyphens), and it does not change when phases are inserted. Two phases with the same slug are refused: neither is listed and `doctor` reports it (the router cannot tell them apart).
- **Task id = the plan id in dotted form**: `01-02` is `1.2`, `02.1-01` is `2.1.1`. Leading zeros drop in each number. The factory's skills, tickets and `tasks.md` convention already use dotted ids. The roadmap line is found by computing this id for each plan line, so no reverse mapping is needed.
- A phase directory whose slug fails the id rule is not listed. A phase in the roadmap with no directory yet (PAUL creates it when the phase is first planned) is not a change.

### Active and archived

A phase is **archived** when either holds:

1. a file `.paul/phases/<dir>/ARCHIVED` exists (the factory wrote it: see `archive` below); or
2. a file in `.paul/milestones/` has a `Phase N:` heading for its number. Any `.md` file there counts: PAUL's template names archives `v{VERSION}-{NAME}.md` and its `complete-milestone` workflow writes `{version}-ROADMAP.md`, so the adapter does not rely on a name.

`listChanges` lists the phase directories that are not archived. `isArchived` is the same test. `archivedTitle` is the roadmap's phase name (`### Phase N: Name`), or the milestone archive's if the roadmap has collapsed it.

### `archive` (the gap that had no native form)

PAUL archives a whole milestone, never one phase. Mapping a change to a milestone would make ids like `v1.0` and would archive other phases with it. Instead `archive(id)` writes the marker `.paul/phases/<dir>/ARCHIVED` (one line: `archived: <date>`) and nothing else. The phase directory stays where it is, so PAUL's own links, STATE.md and a later `complete-milestone` keep working. The marker is a factory file: PAUL ignores it.

### Autonomy and the owner flag (the format has no field)

A sidecar `.paul/phases/<dir>/factory.yml`:

```yaml
merge: human # the only value
pr: per-change # or per-task (the default when the key is absent)
no_go:
  - docs/**
issue: 12 # optional
owner: ['01-03'] # optional: plan ids only the owner can do
```

A missing file means `merge: human`, `pr: per-task`, no `no_go`, no issue. An unknown key, or `merge` other than `human`, is an error, as it is in the OpenSpec adapter. A task is **owner** when its plan has `autonomous: false` in the frontmatter (PAUL's own sign that a checkpoint needs the user, which an unattended run cannot give) or its plan id is in the sidecar's `owner` list. `blockedBy` is the plan's `depends_on`, mapped to dotted ids; a plan with no file yet has none.

### `tickTask`

Changes `- [ ] NN-NN:` to `- [x] NN-NN:` for that one plan line in `ROADMAP.md`, and nothing else. A second tick changes nothing; a missing change or plan rejects. It does not write `SUMMARY.md` or touch `STATE.md`: those belong to PAUL's close step (UNIFY). A bare tick leaves STATE.md behind, so the factory's run for a PAUL project must ask the agent to close the plan the PAUL way first (see "Open" below).

### `scaffold`

`scaffold(id, { title })` creates `.paul/phases/<NN>-<id>/factory.yml` and appends a `### Phase N: <title or id>` section with an empty `**Plans:**` list to `ROADMAP.md`. `N` is the next integer after the highest phase number. It refuses a taken slug or an invalid id, as for OpenSpec. A roadmap with no phase section yet gets the section at the end of the file.

### `setup`

The adapter does not run PAUL's installer (non-goal). `setup` checks that `.paul/ROADMAP.md` exists and returns `{ changed: false }`; with no `.paul/` it throws `run PAUL's own init first`, which `init` shows as a warning.

### `changesIn`

A path under `.paul/phases/<dir>/` is a touch of that phase, if the phase is active. The roadmap and the milestone archives belong to no change.

## Open (not decided here)

- **Skills.** The five agent skills are written for OpenSpec (`openspec validate`, `openspec archive`, `tasks.md`). A PAUL run needs its own steps: run PAUL's close step before the tick, and an archive step that writes the marker. This is a change to the skills, not to the adapter: record it as task 1.4, decide it with the owner before 1.3.
- **Contract fixture.** The shared suite's fixture (`fix-one`, tasks `1.1` to `1.3`) is satisfied by the mapping above, with no change to the contract: phase directory `01-fix-one`, plans `01-01` to `01-03`.
- **The `.paul/` roadmap table.** `ROADMAP.md` carries a status table and a "Current Milestone" block that PAUL maintains. The adapter never edits them; a tick that leaves the table stale is PAUL's close step's to fix.
