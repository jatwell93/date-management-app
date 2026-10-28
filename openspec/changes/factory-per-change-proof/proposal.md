# Proposal: Prove one PR per change

> Throwaway change for `factory-per-change-pr` task 1.3. Archive it once the owner merges its PR.

## Why

`factory-per-change-pr` 1.2 lets a change run as one factory PR. The factory runs `main`'s workflow and router, so the only proof is a live run on `main`.

## What changes

- Two documentation-only tasks that write `openspec/changes/factory-per-change-proof/proof.md`. They change no app code.
- Expected run: the first task opens one PR titled `WIP:`; the second task lands on the same branch as a commit with a `Factory-Task: 1.2` trailer; once the PR settles with no task left, the route job drops `WIP:` and mentions the owner. The owner merges once.

## Autonomy

```yaml
merge: human
pr: per-change
no_go:
  - frontend/**
  - workers/**
  - shared/**
  - database/**
  - scripts/**
```
