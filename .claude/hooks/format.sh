#!/usr/bin/env bash
# PostToolUse (any file-editing tool): keep edited files LF-terminated, and
# prettier-format the JS/TS ones. Best-effort — never blocks the edit, fails
# open on every error path.
#
# **Why this covers more than Write|Edit.** Serena's MCP editors
# (replace_content, replace_symbol_body, insert_*_symbol, replace_in_files)
# write through Python's text mode, which on Windows translates every \n to
# \r\n. `.gitattributes` declares `* text=auto eol=lf`, so those CRLFs never
# reach the repository — git normalizes them on commit, and CI never sees them.
# They do reach eslint, and the `prettier/prettier` rule then reports one
# `Delete CR` error per line: 171 on a single file in one session, none of them
# real. The repeated cost is diagnosing that, and hand-normalizing the file
# before the noise can be told apart from a genuine formatting failure.
#
# Two details that are load-bearing:
#
#   * Serena passes the path as `relative_path` where Claude's own tools pass
#     `file_path`, so both spellings are read. A relative path is resolved
#     against CLAUDE_PROJECT_DIR, because the hook's working directory is not
#     guaranteed to be the project root.
#   * Read-only Serena tools are deliberately NOT matched in settings.json.
#     `find_symbol` and `get_symbols_overview` also carry a `relative_path`, and
#     this script rewrites files — a tool that merely reads one must not reach
#     it, or looking at a file would reformat it.

payload=$(cat)

field() {
  jq -r "$1 // empty" <<<"$payload" 2>/dev/null
}

f=$(field '.tool_response.filePath')
[ -z "$f" ] && f=$(field '.tool_input.file_path')
[ -z "$f" ] && f=$(field '.tool_input.relative_path')
[ -z "$f" ] && exit 0

# Absolute POSIX path or Windows drive path: leave as-is. Anything else is
# relative to the project root, which is how Serena reports paths.
case "$f" in
  /* | [A-Za-z]:*) ;;
  *) f="${CLAUDE_PROJECT_DIR:-.}/$f" ;;
esac

# replace_in_files can be called with a directory, or with no path at all.
[ -f "$f" ] || exit 0

# Text types only. A CR inside a binary is data, not a line ending.
case "$f" in
  *.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs) ;;
  *.json | *.md | *.css | *.scss | *.html | *.yml | *.yaml | *.sql | *.sh | *.txt) ;;
  *) exit 0 ;;
esac

# Normalize line endings first, so the types prettier does not handle here
# (.sql, .sh, .md, .txt) are still corrected. Guarded on the file actually
# containing a CR, to leave mtimes alone on the common case.
#
# The guard is `tr | cmp` and deliberately NOT `grep -q`. MSYS grep treats CRLF
# as the line terminator, so the CR is gone before the pattern is applied and
# `grep -q` reports not-found on a file that is entirely CRLF — measured, not
# assumed. Comparing the stripped stream against the file answers the same
# question in bytes, which is the level the question is actually about.
#
# This strips literal CR *bytes*. An escape sequence in source (the two
# characters backslash-r, as in a CSV writer's '\r\n') is unaffected — it
# contains no CR byte — so tests that assert CRLF output keep working.
if ! LC_ALL=C tr -d $'\r' <"$f" | cmp -s - "$f" 2>/dev/null; then
  tmp=$(mktemp "$f.eol.XXXXXX" 2>/dev/null) || exit 0
  if LC_ALL=C tr -d $'\r' <"$f" >"$tmp" 2>/dev/null; then
    mv "$tmp" "$f" 2>/dev/null || rm -f "$tmp"
  else
    rm -f "$tmp"
  fi
fi

# Formatting stays scoped to JS/TS, as before. Widening it to .md or .json would
# reflow documents this hook was never asked to touch.
case "$f" in
  *.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs)
    npx prettier --write "$f" >/dev/null 2>&1 || true
    ;;
esac

exit 0
