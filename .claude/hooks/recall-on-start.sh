#!/usr/bin/env bash
# SessionStart: inject recalled project lessons for the current branch name so
# earlier fixes and decisions reach the model without anyone asking. Fails open:
# a missing local index (project-memory.mv2) or memvid binary produces no output.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
case "$branch" in main|master|HEAD) exit 0 ;; esac
[ -f project-memory.mv2 ] || exit 0

# feature/foo-bar-baz -> "foo bar baz"
query=$(printf '%s' "$branch" | sed -e 's#^[a-z]*/##' -e 's#[-_/]# #g')
[ -z "$query" ] && exit 0

hits=$(timeout 15 node scripts/mem-recall.js "$query" 2>/dev/null | head -c 3000)
[ -z "$hits" ] && exit 0

jq -n --arg h "$hits" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: ("Project memory recall for this branch (memory.jsonl, advisory):\n" + $h)}}'
