## Why

Root `npm run lint` currently reports hundreds of diagnostics, including non-runtime local tooling files and frontend test globals. The frontend and backend package lint scripts pass with warnings only, but the warning volume obscures real regressions and increases agent/tool output.

## What Changes

- Narrow root lint scope by ignoring local AI/tooling reference folders that are not part of the app runtime.
- Align root ESLint test globals with the current Vitest migration so frontend tests are linted as tests instead of generic browser modules.
- Remove backend warning noise from unused Express middleware parameters, unused imports, and narrowly typed values.
- Reduce frontend warning noise in tests and mocks by replacing broad `any` usage, removing unused variables, and preferring Testing Library queries over DOM-node access where practical.
- Keep any unavoidable test-query exceptions local and documented rather than disabling warning classes globally.

## Capabilities

### Modified Capabilities

- `developer-quality-gates`: Root, frontend, and backend lint output is easier to act on because known irrelevant files and fixable warnings no longer dominate the diagnostics.

## Impact

- Affected code: `eslint.config.js`, `eslint.ignores.js`, frontend test/mocking files, and backend controller/repository/service files with current warnings.
- APIs: No runtime API, database schema, or user-facing behavior changes.
- Dependencies: No new runtime dependencies.
