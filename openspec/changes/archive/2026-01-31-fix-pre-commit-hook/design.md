## Context

The user attempted to manually create a Git pre-commit hook to run the Ultimate Bug Scanner (UBS). The resulting `.git/hooks/pre-commit` file is missing a shebang line, contains trailing text from a copy-paste error (`HOOK`), and is not executable or recognizable by Git on Windows, leading to a "cannot spawn" error.

## Goals / Non-Goals

**Goals:**
- Correct the `.git/hooks/pre-commit` file structure (add shebang, remove noise).
- Ensure the hook is executable and correctly blocks commits on critical UBS findings.
- Restore the `git commit` functionality.

**Non-Goals:**
- Modifying the UBS tool itself.
- Altering the project's build or test scripts.

## Decisions

- **Use standard shell shebang**: Use `#!/bin/sh` to ensure compatibility with Git's internal execution environment on both Windows (Git Bash) and Unix systems.
- **Command availability check**: Retain the check for the `ubs` command to provide a clear installation requirement message if it's missing.
- **Fail-fast on critical issues**: The hook will exit with code 1 if `ubs` finds critical issues, effectively blocking the commit as intended by the user.
- **Output Redirection**: Maintain redirection to `bug-scan-report.json` for later inspection.

## Risks / Trade-offs

- **Risk**: The `ubs` command might be available in the interactive terminal but not in the shell spawned by Git.
- **Mitigation**: The hook already includes a check for `ubs` existence and outputs a clear error message if it's not found.
