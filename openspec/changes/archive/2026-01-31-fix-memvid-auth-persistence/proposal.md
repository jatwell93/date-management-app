## Why

The `mem-recall.js` and `mem-log.js` scripts currently rely on the `GEMINI_API_KEY` environment variable being set in the active terminal session. This forces users to manually export the key every time they start a new terminal, leading to friction and frequent "API Key not found" errors when using memory features.

## What Changes

- Install `dotenv` in the root workspace to manage environment variables project-wide.
- Update `scripts/mem-recall.js` to automatically load surroundings from a `.env` file at the root.
- Update `scripts/mem-log.js` to automatically load surroundings from a `.env` file at the root.
- Add a placeholder for `GEMINI_API_KEY` in the root `.env` file (if not already managed).

## Capabilities

### New Capabilities
- `environment-variable-management`: Centralized management of project-wide environment variables using .env files for local development.

### Modified Capabilities
- `memory-management`: Extend memory retrieval and logging to support automatic environment configuration.

## Impact

- `scripts/mem-recall.js`: Will now require `dotenv`.
- `scripts/mem-log.js`: Will now require `dotenv`.
- Root directory: Added `dotenv` to `devDependencies` in `package.json`.
- `.env`: Will now store and manage `GEMINI_API_KEY`.
