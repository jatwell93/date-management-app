#!/usr/bin/env bash
# Stop / PreCompact: advisory only, never blocks. Once per session, remind the
# user to capture lessons when this branch has changes but adds no memory.jsonl
# entry. memory.jsonl is the committed, tool-agnostic lesson store (AGENTS.md §7).
#
# Limit: systemMessage reaches the user, not the model. The model-facing rule
# lives in AGENTS.md §7; this hook only closes the "nobody remembered" gap.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

input=$(cat 2>/dev/null)
session=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
event=$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null)
[ -z "$session" ] && session="nosession"

marker="${TMPDIR:-/tmp}/lesson-nudge-${session}-${event:-event}"
[ -f "$marker" ] && exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
case "$branch" in main|master|HEAD) exit 0 ;; esac

base=$(git merge-base origin/main HEAD 2>/dev/null || git merge-base main HEAD 2>/dev/null) || exit 0

# Any change on this branch, committed or not, excluding memory.jsonl itself.
changed=$(git diff --name-only "$base" 2>/dev/null | grep -v '^memory\.jsonl$' | head -1)
[ -z "$changed" ] && exit 0

# An entry added on this branch counts as captured.
if git diff "$base" -- memory.jsonl 2>/dev/null | grep -q '^+{'; then
  exit 0
fi

: > "$marker" 2>/dev/null

if [ "$event" = "PreCompact" ]; then
  msg='Before compacting: log a checkpoint (state, next step, any lesson) with: node scripts/mem-log.js WORKFLOW "<title>" "<message>". No secrets: memory.jsonl is public.'
else
  msg='No lesson logged on this branch yet. If you fixed a bug, made a decision or found a pattern, log it: node scripts/mem-log.js <KIND> "<title>" "<message>" (no secrets: memory.jsonl is public).'
fi

jq -n --arg m "$msg" '{systemMessage: $m}'
