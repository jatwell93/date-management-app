---
name: document-generate
description: >-
  Write or refresh internal documentation in docs/ from the code, in the four
  Diataxis kinds (tutorial, how-to, reference, explanation): inventory the
  existing docs with the owner (keep, regenerate, delete), research the code
  and tests, write reference docs first, cross-link, self-review for accuracy,
  then commit on a feature branch and open a PR. Use when the user says
  "document this", "generate docs", "refresh the docs", "write a how-to",
  "explain this module", or "/document-generate <target>". Do NOT use for
  user-facing store-staff docs that need screenshots or recordings: those are
  written by the owner.
---

# Generate internal documentation

Produce accurate, structured documentation for a feature, a module, or the
whole project. Research the code before writing a line. Every claim in a
document must be traceable to code or tests.

Documentation follows the **Diataxis framework**: four kinds, each for a
different reader need.

- **Tutorial:** learning-oriented. It walks a newcomer through a working example.
- **How-to:** task-oriented. It shows how to reach one goal, for a reader who knows the basics.
- **Reference:** information-oriented. It is a complete and accurate technical description.
- **Explanation:** understanding-oriented. It says why things work the way they do.

Research the whole, then write the parts. This prevents documentation that
describes half a feature.

## Repo facts that apply to every document

- The API is `workers/` (Cloudflare Workers) on Neon Postgres; the frontend is
  `frontend/`; shared code is `shared/`. Express (`backend/`) is retired:
  never document it as current. Only `workers/src/index-minimal.ts` is
  deployed. Before documenting a Worker file, confirm it is reachable from
  that entry (grep for its imports, following re-exports); an unreachable file
  is dead code, not surface to document.
- `docs/DOCUMENTATION_QUICK_REFERENCE.md` is the docs index. Completed
  implementation summaries and phase reports belong in OpenSpec archives, not
  in `docs/`.
- Existing file names in `docs/` are kebab-case (`database-migrations.md`).
  Follow that; do not add Diataxis prefixes unless the owner asks for them.
- Never put secrets, real customer data, production hostnames with
  credentials, or the owner's email in a document.

## Step 0: Scope

1. Work out what to document:
   - **A named target** (feature, module, file, skill): the scope is that target.
   - **The whole project**, or "refresh the docs": the scope is all of `docs/`
     plus the code's public surface. Do step 1 (inventory) first.
2. Ask the owner, with AskUserQuestion, where the output goes:
   - A) Inline in existing files (README, AGENTS.md, an existing doc).
   - B) Standalone files in `docs/`.
   - C) Both: short summaries in existing files, deep docs in `docs/`.

   Recommend C: it is the easiest to find and the most complete.
3. Run `git switch -c feature/docs-<scope>` from an up-to-date `main`.

## Step 1: Inventory the existing docs (refresh only)

Skip this step for a single named target that has no existing doc.

1. List every file under `docs/` (excluding `docs/evidence/`). For each,
   read it and check it against the code: does what it describes still
   exist, and does it say what the code does now?
2. Mark each one:
   - **keep:** accurate and still useful.
   - **regenerate:** the subject is current, but the doc is stale or thin.
   - **delete:** it describes retired code (Express, SQLite, the
     single-tenant era), a finished one-off, or something no longer in the
     repo. Name the evidence (a missing path, a retired tag) for each.
   - **move:** a completed report or plan that belongs in an OpenSpec archive.
3. Present the list to the owner and get a decision on every `delete` and
   `move`. Never delete a doc the owner has not approved. If the list is long,
   ask in batches of at most 4 per question.
4. Docs marked `regenerate` join the scope for step 2.

## Step 2: Research the code

The quality of the docs depends on this step most.

1. Read the entry points: `README.md`, `AGENTS.md`, the package's
   `package.json`, and the main entry files (`workers/src/index-minimal.ts`,
   `frontend/src/index.*`, the route modules).
2. For each target, read:
   - the implementation files, end to end (not only signatures);
   - the tests, which show intended behaviour, edge cases and usage;
   - the modules it depends on and the ones that depend on it;
   - comments that give a reason (`NOTE`, `WHY`, the OpenSpec change named
     in a comment), and the OpenSpec spec in `openspec/specs/` that covers it.
3. Build a concept map before writing:

   ```
   Target: [name]
   Purpose: [one sentence: what problem it solves]
   Key concepts: [the 3-5 a reader must understand]
   Public surface: [routes, commands, functions, config options]
   Dependencies: [what it needs]
   Dependents: [what relies on it]
   Edge cases: [from tests and code]
   Design decisions: [non-obvious "why" choices]
   ```

4. Report: "Researched N files, found K public surface items, M concepts and J
   design decisions."

## Step 3: Partition into Diataxis kinds

For each target, choose which kinds to write. Not every target needs all four.

| Target type | Tutorial | How-to | Reference | Explanation |
|---|---|---|---|---|
| Feature a developer interacts with | yes | yes | yes | maybe |
| CLI command or npm script | maybe | yes | yes | no |
| Internal module or architecture | no | no | yes | yes |
| Config option or environment variable | no | yes | yes | no |
| Design pattern or principle | no | no | no | yes |
| API route | maybe | yes | yes | no |
| Multi-step workflow (deploy, migration) | yes | yes | no | maybe |

Print the plan:

```
Documentation plan:
  [target]              [tutorial] [how-to] [reference] [explanation]
  Credit claims API     no         new      new         new
  npm run test:db       no         new      inline      no
```

If the plan creates more than 5 documents, confirm it with the owner first.

## Step 4: Write reference docs first

Reference docs set the vocabulary, so write them before the other kinds.

```markdown
# [Name]

[One paragraph: what it is, what it does, when you would use it.]

## Interface

[The whole public surface: routes, functions, commands, options, with types,
defaults and constraints, taken from the code.]

## Configuration

[If any: every option, its type, default and effect.]

## Examples

[2-3 real examples that work if copied.]

## Related

[Links to the how-to, explanation and other reference docs.]
```

- Accuracy over elegance. Every claim must trace to code.
- Give types, defaults and constraints: not "accepts a string" but "accepts a
  string (max 256 characters, must match `^[a-z-]+$`)".
- Do not explain why here: that belongs in an explanation doc.

## Step 5: Write explanation docs

```markdown
# [Concept or design decision]

[The problem this design solves, for a smart reader who has not seen the code.]

## The problem

[What goes wrong without it: real failure modes.]

## The approach

[How the design solves it. Use an ASCII or Mermaid diagram for architecture.]

## Trade-offs

[What was given up.]

## Alternatives considered

[If the code, OpenSpec archives or git history show them.]
```

- Lead with the problem, not the solution.
- Name each trade-off: "We chose X over Y because Z."
- Link to reference material instead of repeating it.

## Step 6: Write how-to guides

```markdown
# How to [task]

[One sentence: what you will reach.]

## Prerequisites

[Tools, versions, access, config state.]

## Steps

1. [Verb] [instruction]

   ```bash
   [exact command]
   ```

   [Expected result, if not obvious.]

## Verification

[A command, URL or test that proves it worked.]

## Troubleshooting

[Common failures and fixes, from tests and error handling.]
```

- The title starts with "How to".
- Every step is an action: "Run X" or "Add Y to Z", never "consider whether".
- Troubleshooting is required when the task can fail.
- Never write a step that runs `npm run test:prod`, writes to production
  Neon, or needs production credentials without saying so in bold at that
  step.

## Step 7: Write tutorials

```markdown
# [What you will build or learn]

[What you will build, why it is useful, and what you will understand at the end.]

## What you need

## Step 1: [Set up]

## Step 2: [First working piece]

## What you built

[What the reader now has. Link to reference docs and next steps.]
```

- The reader sees something work by step 3.
- Every step gives a visible change or output.
- Use the exact commands the reader types.

## Step 8: Cross-link

1. Each reference doc links to its how-to; each how-to links to its
   reference; tutorials link to both.
2. Add every new doc to `docs/DOCUMENTATION_QUICK_REFERENCE.md`, and remove
   entries for deleted or moved docs. Add a pointer to `AGENTS.md` only if
   agents need the doc on every task.
3. Check for broken links: for every `](` target in a changed doc, the file
   must exist. Also grep the repo for links to any doc you deleted or moved.

## Step 9: Self-review

Check each document before committing. Fix every failure.

- **Accuracy:** every example runs if copied; every interface matches the
  code; every command gives the output described; nothing refers to renamed,
  removed or retired code.
- **Completeness:** reference docs cover the whole public surface of their
  target; how-tos cover the top 3 tasks; tutorials reach a working result by
  step 3; explanation docs name trade-offs.
- **Voice:** written for a smart reader who has not seen the code; jargon
  glossed on first use; active voice, concrete nouns, short sentences.

## Step 10: Commit and open the PR

1. Stage documentation files by name (never `git add -A` or `git add .`).
   The pre-commit hook runs `git-secrets` when it is installed; also read the
   staged diff yourself for anything that looks like a live key, token or
   connection string, and remove it before committing.
2. Run `npm run lint`.
3. Commit with a conventional message: `docs: <scope>` with a one-line summary
   and the kinds produced in the body.
4. Push and open the PR with a body that follows
   `.github/PULL_REQUEST_TEMPLATE.md`. Add a
   `## Documentation` table listing each new, regenerated, deleted or moved
   file, its Diataxis kind and a one-line description. Then run `babysit-pr`.
   The owner merges.
5. Report:

   ```
   Documentation generated:
     Scope: [what]
     Files: [N] new, [M] regenerated, [D] deleted, [V] moved
     Tutorials:   [count] ([list])
     How-tos:     [count] ([list])
     Reference:   [count] ([list])
     Explanation: [count] ([list])
     Self-review: [pass or fail per gate]
   ```

## Rules

- Research before writing. Step 2 is not optional.
- Accuracy is required. If unsure about a detail, read the source again; do
  not guess.
- Keep the kinds apart: no tutorial content in reference docs, no reference
  content in how-tos.
- Complete over minimal for the scope you agreed, but never document dead or
  retired code to make coverage look complete.

---

Adapted from `document-generate` in [garrytan/gstack](https://github.com/garrytan/gstack)
(`document-generate/SKILL.md` at commit `3e4240a7`), MIT License, Copyright (c)
2026 Garry Tan. The gstack preamble, telemetry, question tuning and redaction
tooling are removed; the existing-docs inventory and the repo rules are added.
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions: The above copyright notice and this
permission notice shall be included in all copies or substantial portions of
the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
