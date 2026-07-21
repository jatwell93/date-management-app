#!/usr/bin/env bash
# PreToolUse (Write): block creating NEW *.md files directly in the repo root,
# except README/CLAUDE/AGENTS. Enforces the AGENTS.md rule "no ad-hoc
# planning/TODO/markdown files in the repo root" (docs go under docs/, work is
# tracked in OpenSpec). Editing an existing root .md is allowed. Fails open.
f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] && exit 0

# Normalize backslashes to forward slashes so Windows and POSIX paths both parse.
p=$(printf '%s' "$f" | tr '\\' '/')

# Only consider paths inside this repo.
case "$p" in
  */date-management-app/*) rest=${p##*/date-management-app/} ;;
  *) exit 0 ;;
esac

# A slash in the remainder means it lives in a subdirectory (docs/, openspec/, …) — fine.
case "$rest" in */*) exit 0 ;; esac

# Only markdown at the root is in scope.
case "$rest" in *.md) ;; *) exit 0 ;; esac

# Allowlisted root docs.
case "$rest" in README.md|CLAUDE.md|AGENTS.md) exit 0 ;; esac

# Editing an existing file is allowed; only NEW stray files are blocked.
[ -e "$p" ] && exit 0

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"New root-level .md files are blocked (AGENTS.md: no ad-hoc planning/TODO files in the repo root). Put docs under docs/ or track the work in OpenSpec."}}
JSON
