# Proposal: Add a GSD spec-source adapter to software-factory

## Why

The factory reads a change only through the `SpecSourceAdapter` contract. Task 6.1 of `extract-software-factory` (design.md section 4) found that GSD's `.planning/` format carries the read half of that contract but lacks autonomy settings, a per-change archive and a safe task tick. A GSD project cannot use the factory until an adapter fills those gaps.

## What changes

- A `gsd` adapter in the software-factory repo (`adapters/gsd.js`), passing the shared contract suite.
- Change = phase directory under `.planning/phases/`; task = plan line in `ROADMAP.md`.
- Autonomy and the owner flag come from a sidecar file; the format has no field for them.
- `tickTask` edits the roadmap line only. A factory step asks the agent to run GSD's own close step (summary) first.
- A decision on per-phase `archive` (see design.md section 4, "bespoke adapter needs").
- Pin a tested `open-gsd/gsd-core` commit: its format changes often.

Source studied: `open-gsd/gsd-core` branch `next` (read only, nothing run, nothing installed).

## Autonomy

- merge: human
- pr: per-change

## Non-goals

- Running GSD's installer or commands from the factory.
- Changing the contract, unless the contract suite proves it cannot express GSD.
