#!/usr/bin/env bash
# PreToolUse (Write): block creating NEW *.md files directly in the repo root,
# except README/CLAUDE/AGENTS. Enforces the AGENTS.md rule "no ad-hoc
# planning/TODO/markdown files in the repo root" (docs go under docs/, work is
# tracked in OpenSpec). Editing an existing root .md is allowed.
# Fails open: any unexpected condition allows the write.

# Canonicalize a path for comparison: backslashes -> slashes, MSYS /c/x -> c:/x,
# and lowercase the drive letter so Windows path flavors compare equal.
canon() {
  local s
  s=$(printf '%s' "$1" | tr '\\' '/')
  case "$s" in
    /[A-Za-z]/*) s="${s:1:1}:${s:2}" ;;
  esac
  case "$s" in
    [A-Za-z]:/*) s="$(printf '%s' "${s%%:*}" | tr 'A-Z' 'a-z'):${s#*:}" ;;
  esac
  printf '%s' "${s%/}"
}

f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] && exit 0

# Discover the repo root dynamically so this works under any clone directory name.
root=$(cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)
[ -z "$root" ] && exit 0

p=$(printf '%s' "$f" | tr '\\' '/')
while :; do case "$p" in ./*) p=${p#./} ;; *) break ;; esac; done   # strip leading ./

# Resolve relative paths (e.g. "NOTES.md") against the repo root before comparing.
case "$p" in
  /*|[A-Za-z]:/*) abs=$p ;;
  *) abs="${root%/}/$p" ;;
esac

croot=$(canon "$root")
cabs=$(canon "$abs")

# Only files inside this repo are in scope.
case "$cabs" in
  "$croot"/*) rest=${cabs#"$croot"/} ;;
  *) exit 0 ;;
esac

case "$rest" in */*) exit 0 ;; esac                 # in a subdirectory - fine
case "$rest" in *.md) ;; *) exit 0 ;; esac          # not markdown - fine
case "$rest" in README.md|CLAUDE.md|AGENTS.md) exit 0 ;; esac
[ -e "$abs" ] && exit 0                             # existing file - editing allowed

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"New root-level .md files are blocked (AGENTS.md: no ad-hoc planning/TODO files in the repo root). Put docs under docs/ or track the work in OpenSpec."}}
JSON
