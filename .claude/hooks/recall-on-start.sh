#!/usr/bin/env bash
# SessionStart: inject recalled project lessons for the current branch name so
# earlier fixes and decisions reach the model without anyone asking. Fails open:
# every failure path produces no output.
#
# Ranked recall needs the local, gitignored index (project-memory.mv2) plus the
# memvid binary. On a fresh clone, a second machine or a sandboxed agent neither
# exists, so fall back to a plain keyword match over the committed memory.jsonl.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
case "$branch" in main|master|HEAD) exit 0 ;; esac

# feature/foo-bar-baz -> "foo bar baz"
query=$(printf '%s' "$branch" | sed -e 's#^[a-z]*/##' -e 's#[-_/]# #g')
[ -z "$query" ] && exit 0

label="memory.jsonl, advisory"
hits=""

if [ -f project-memory.mv2 ]; then
  # `timeout` is GNU coreutils and absent on stock macOS; the hook is already
  # bounded by the timeout in .claude/settings.json.
  if command -v timeout >/dev/null 2>&1; then
    hits=$(timeout 15 node scripts/mem-recall.js "$query" 2>/dev/null | head -c 3000)
  else
    hits=$(node scripts/mem-recall.js "$query" 2>/dev/null | head -c 3000)
  fi
  # mem-recall.js prints this notice with exit 0 when the index has no match.
  case "$hits" in "No project memories found"*) hits="" ;; esac
  [ -n "$hits" ] && label="ranked recall (project-memory.mv2), advisory"
fi

if [ -z "$hits" ] && [ -f memory.jsonl ]; then
  # Words of 4+ characters only; shorter ones ("fix", "add") match everything.
  words=$(printf '%s\n' $query | awk 'length($0) >= 4' | jq -R . | jq -s -c .)
  if [ -n "$words" ] && [ "$words" != "[]" ]; then
    hits=$(jq -R -r --argjson w "$words" '
      fromjson? | select(.title != null)
      | (((.title // "") + " " + (.message // "")) | ascii_downcase) as $text
      | {kind, title, message, score: ([$w[] | select(. as $x | $text | contains($x | ascii_downcase))] | length)}
      | select(.score > 0)
      | "\(.score)\t[\(.kind)] \(.title): \(.message[0:300])"
    ' memory.jsonl 2>/dev/null | sort -t "$(printf '\t')" -k1,1nr | head -5 | cut -f2- | head -c 3000)
    if [ -n "$hits" ]; then
      hits="${hits}"$'\n'"(Keyword match only. Run npm run mem:rebuild for ranked recall.)"
      label="keyword fallback over memory.jsonl, advisory"
    fi
  fi
fi

[ -z "$hits" ] && exit 0

# Entries written before the redaction guard existed are not covered by it, so
# check again before injecting into model context.
redact="$(cd "$(dirname "$0")" && pwd)/../../scripts/mem-redact.js"
if [ -f "$redact" ] && ! printf '%s' "$hits" | node "$redact" >/dev/null 2>&1; then
  exit 0
fi

jq -n --arg h "$hits" --arg l "$label" '{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: ("Project memory recall for this branch (" + $l + "):\n" + $h)}}'
