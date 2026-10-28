# Tasks: Prove one PR per change

Both tasks edit only `openspec/changes/factory-per-change-proof/proof.md`. No tests or app code; the gate is `npm run lint`.

## 1. Proof

- [x] 1.1 Create `openspec/changes/factory-per-change-proof/proof.md` with a `# Per-change proof` heading and one line: `- 1.1: first task, opened the PR.`
- [x] 1.2 Append one line to `openspec/changes/factory-per-change-proof/proof.md`: `- 1.2: second task, same branch and PR.` Commit it on the existing per-change branch with a `Factory-Task: 1.2` trailer.
- [ ] 1.3 Append one line to `openspec/changes/factory-per-change-proof/proof.md`: `- 1.3: third task, same branch and PR as 1.2.` Commit it on the existing per-change branch with a `Factory-Task: 1.3` trailer.
