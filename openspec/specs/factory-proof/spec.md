# factory-proof Specification

## Purpose
Records, in a throwaway proof file, each task the factory landed, so the factory's ticket, per-change PR and archive steps can be exercised end to end. A later cleanup PR removes this capability.

## Requirements

### Requirement: The factory proof file records each task

The throwaway change `factory-tickets-proof` SHALL keep a proof file, `proof.md` in its change folder, with one line per task that the factory landed, in task order. This capability exists only to exercise the factory's archive step; a later cleanup PR removes it from `openspec/specs/`.

#### Scenario: Both tasks landed

- **GIVEN** the factory ran tasks 1.1 and 1.2 of `factory-tickets-proof`
- **WHEN** the owner reads `proof.md`
- **THEN** it has a `# Tickets proof` heading and one line for each task, 1.1 first
