# Proposal: Add a PAUL spec-source adapter to software-factory

## Why

The factory reads a change only through the `SpecSourceAdapter` contract. Task 6.1 of `extract-software-factory` (design.md section 4) found that PAUL's `.paul/` format carries the read half of that contract but lacks autonomy settings, a per-change archive and a safe task tick. A PAUL project cannot use the factory until an adapter fills those gaps.

## What changes

- A `paul` adapter in the software-factory repo (`adapters/paul.js`), passing the shared contract suite.
- Change = phase directory under `.paul/phases/`; task = plan line in `ROADMAP.md`.
- Autonomy and the owner flag come from a sidecar file; the format has no field for them.
- `tickTask` edits the roadmap line only. A factory step asks the agent to run PAUL's own close step (UNIFY) first.
- A decision on per-phase `archive` (see design.md section 4, "bespoke adapter needs").

Source studied: `ChristopherKahler/paul` (read only, nothing run).

## Autonomy

- merge: human
- pr: per-change

## Non-goals

- Running PAUL's installer or commands from the factory.
- Changing the contract, unless the contract suite proves it cannot express PAUL.
