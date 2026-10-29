# Tasks: Prove tickets to archive

Both tasks edit only `openspec/changes/factory-tickets-proof/proof.md`. No tests or app code; the gate is `npm run lint`.

## 1. Proof

- [x] 1.1 Start the proof file (#753): create `openspec/changes/factory-tickets-proof/proof.md` with a `# Tickets proof` heading and one line: `- 1.1: first task, opened the PR.`
      Demo: the owner's merge of the plan PR starts this task with no dispatch, and one `WIP:` PR opens.
      Acceptance: the file exists with the heading and the line; `npm run lint` passes.
- [ ] 1.2 Record the second task (#754): append one line to `openspec/changes/factory-tickets-proof/proof.md`: `- 1.2: second task, same branch and PR.` Commit it on the existing per-change branch with a `Factory-Task: 1.2` trailer.
      Demo: a second commit on the same PR, then an archive run on that PR before the owner is mentioned.
      Acceptance: the file has both lines in order; `npm run lint` passes.
      Blocked by: 1.1.
