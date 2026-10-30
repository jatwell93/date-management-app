# Proposal: Prove tickets to archive

> Throwaway change for `factory-tickets-and-autostart` task 6.1. The factory archives it itself.

## Why

`factory-tickets-and-autostart` lets the owner's input end at planning: `/to-tickets` publishes the tasks as tickets, the owner's merge of the plan PR starts the build, each task's PR closes its ticket, and the factory archives the finished change. The factory runs `main`'s workflow and router, so the only proof is a live run on `main`.

## What changes

- Two documentation-only tasks that write `openspec/changes/factory-tickets-proof/proof.md`. They change no app code.
- Expected run: the owner merges the plan PR (labelled `factory:factory-tickets-proof` and `factory-ready`), which starts task 1.1 with no dispatch. Task 1.1 opens one `WIP:` PR; task 1.2 lands on the same branch; then an archive run commits the archived change on that PR, and only then the route job drops `WIP:` and mentions the owner. The owner's one merge closes both tickets and the tracking issue.

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
