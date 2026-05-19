## Why

The `docs/` folder contains a mix of durable guides, launch-era phase reports, completed implementation summaries, and stale cross-references. This cleanup makes the documentation set easier to navigate and brings the entry-point docs back in line with the current backend, frontend, workers, Agentlens, codemap, graphify, and OpenSpec view of the project.

## What Changes

- Remove obsolete completed-work artifacts from `docs/` when their content is superseded by current code, OpenSpec archives, or durable operational guides.
- Update stale entry-point documentation that still describes old phase status, old test counts, or removed files.
- Keep durable runbooks and user/operator references, but refresh links and status wording where clearly behind.
- Validate the cleanup with OpenSpec and documentation-oriented checks.

## Capabilities

### New Capabilities

- `documentation-maintenance`: Project documentation stays current, discoverable, and free of obsolete completed-work artifacts.

### Modified Capabilities

- None. No product requirements or runtime behavior change.

## Impact

- Affected files are documentation and OpenSpec tracking files only.
- No backend, frontend, workers, database, API, or dependency behavior is changed.
