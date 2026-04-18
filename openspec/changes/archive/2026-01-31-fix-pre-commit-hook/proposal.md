## Why

The Git pre-commit hook is failing on Windows with an "error: cannot spawn .git/hooks/pre-commit: No such file or directory" error. This is caused by the absence of a shebang line (`#!/bin/sh`), corrupted content (trailing `HOOK` string from a failed heredoc copy), and potentially incorrect line endings or permissions.

## What Changes

- Update `.git/hooks/pre-commit` to:
  - Include a standard `#!/bin/sh` shebang.
  - Remove the trailing `HOOK` identifier.
  - Correctly check for the `ubs` command.
  - Run `ubs` and capture output to `bug-scan-report.json`.
- Ensure the hook file is executable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None.

## Impact

- Local Git `.git/hooks/pre-commit` file.
- The `git commit` workflow for the user.
- Tracking of `bug-scan-report.json` via `.gitignore` (already handled).
