# Proposal: Prove the factory on its pinned ref

> Throwaway change for `extract-software-factory` task 3.1. The factory archives it itself.

## Why

This repo now runs the factory from `jatwell93/software-factory` at a pinned commit instead of its own vendored copies. The workflows have only been tested statically, so the only proof is a live run on `main`.

## What changes

- Two documentation-only tasks that write `openspec/changes/factory-pinned-proof/proof.md`. They change no app code.
- Expected run: the owner merges the plan PR (labelled `factory:factory-pinned-proof` and `factory-ready`), which starts task 1.1 with no dispatch. Task 1.1 opens one `WIP:` PR; task 1.2 lands on the same branch; an archive run commits the archived change on that PR; then the route job drops `WIP:` and mentions the owner. The run records its cost and duration for the daily digest. The owner merges once.

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
