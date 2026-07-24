#!/usr/bin/env bash
# Stop: advisory only. Warn (never block) if changed JS/TS files still contain
# leftover console.log or debugger statements. Scans tracked changes vs HEAD.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
hits=$(git diff HEAD --name-only --diff-filter=ACM 2>/dev/null \
  | grep -E '\.(ts|tsx|js|jsx)$' \
  | while IFS= read -r file; do
      [ -f "$file" ] && grep -Hn -E 'console\.log|debugger' "$file"
    done)
[ -z "$hits" ] && exit 0
printf '%s' "$hits" | jq -Rs '{systemMessage: ("Heads-up — leftover debug statements in changed files:\n" + .)}'
