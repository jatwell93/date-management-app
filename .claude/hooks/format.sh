#!/usr/bin/env bash
# PostToolUse (Write|Edit): auto-format edited JS/TS files with the repo's
# local prettier. Best-effort — never blocks the edit. Fails open.
f=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -z "$f" ] && exit 0
case "$f" in
  *.ts|*.tsx|*.js|*.jsx) npx prettier --write "$f" >/dev/null 2>&1 || true ;;
esac
exit 0
