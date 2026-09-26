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
#   * `create_text_file` IS matched, along with the in-place editors. It writes
#     through the same Python text mode, so a file it creates lands CRLF too.
#   * `NotebookEdit` is deliberately NOT matched. Its input carries the path as
#     `notebook_path`, which nothing here reads, and `.ipynb` is not in the type
#     whitelist below — so matching it would advertise normalization this script
#     does not perform. The repository contains no notebooks; add both the field
#     and the extension together if that changes.

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
    # `cat`, not `mv`: write the bytes back through the ORIGINAL inode.
    #
    # mktemp always creates its file 0600, and the template is in the same
    # directory as the target, so `mv` is a plain rename — the temp file's mode
    # and ownership become the target's. That silently clears the executable bit
    # from a `.sh` in the whitelist above (scripts/setup-git-secrets.sh,
    # scripts/pitr-drill.sh) and drops group/world read from everything else. A
    # rename also replaces a symlinked path with a regular file rather than
    # writing through to its target.
    #
    # The trade-off is atomicity: `cat` truncates before writing, so a crash
    # mid-copy leaves the file short, where a rename never could. Accepted,
    # because the bytes are already fully materialized in "$tmp" by the time this
    # runs — this is a local file-to-file copy, not the stream that produced them.
    cat "$tmp" >"$f" 2>/dev/null
  fi
  rm -f "$tmp"
fi

# Formatting stays scoped to JS/TS, as before. Widening it to .md or .json would
# reflow documents this hook was never asked to touch.
case "$f" in
  *.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs)
    npx prettier --write "$f" >/dev/null 2>&1 || true
    ;;
esac

exit 0
