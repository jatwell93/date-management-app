## Context

The project uses `memvid` for project memory management. The retrieval (`mem-recall.js`) and logging (`mem-log.js`) scripts currently check for `process.env.GEMINI_API_KEY` but do not load any environment configuration files (like `.env`). This results in a disconnected experience where users must manually manage their environment variables in every shell session.

## Goals / Non-Goals

**Goals:**

- Provide a persistent way to store and load the `GEMINI_API_KEY` for local development.
- Ensure all memory management scripts automatically pick up configuration from the `.env` file.
- Maintain compatibility with manual environment variable overrides.

**Non-Goals:**

- Global shell configuration modification (e.g., editing `.bashrc`).
- Implementing a custom configuration UI or credential manager.

## Decisions

- **Decision: Use `dotenv` for environment variable loading.**
  - **Rationale**: `dotenv` is the industry standard for Node.js projects. It is already used and available in the `backend/` directory, so adding it to the root project aligns with existing patterns.
  - **Alternative considered**: Implementing a custom `.env` parser. While this avoids a dependency, it's brittle and non-standard.

- **Decision: Install `dotenv` in the root workspace.**
  - **Rationale**: Since the memory scripts are at the root level (`scripts/`), they should have their own developer dependency management in the root `package.json`.

## Risks / Trade-offs

- **Risk**: Accidentally committing `.env` with the API key.
- **Mitigation**: Ensure `.env` is already in `.gitignore` (existing state) and provide a `.env.example` if needed.
