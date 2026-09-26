'use strict';

/**
 * One place to invoke the `memvid` CLI from the `mem-*` scripts.
 *
 * **Why this exists.** `mem-log.js`, `mem-rebuild.js` and `mem-backfill.js` each
 * called `execFileSync('memvid', argv, { shell: true })`. With `shell: true`,
 * Node joins the argv array into a single command string **without quoting it**,
 * so every argument containing a space became several arguments. The effect:
 *
 *     $ npm run mem:rebuild
 *     error: unexpected argument 'Overview' found
 *     ❌ Memory rebuild failed: Failed to rebuild memory record 1 (Project Overview)
 *
 * Every multi-word `--title` failed, which is essentially every real title. The
 * index half of `mem-log.js` failed the same way and reported only a warning, so
 * `memory.jsonl` kept its entries (it is written first, and is the committed
 * source of truth) while the local search index silently fell behind — which is
 * what `mem-recall.js` reads. Memory logging appeared to work and recall quietly
 * did not see recent entries.
 *
 * **Why the shell is still used.** `shell: true` cannot simply be dropped. On
 * Windows the `memvid` on PATH is an npm shim (`memvid`, `memvid.cmd`,
 * `memvid.ps1`), and Node refuses to spawn a `.cmd` without a shell; with no
 * shell it fails `ENOENT` (measured). The scripts' own tests also install their
 * stub as `memvid.cmd`. So the command string stays, and this module builds it
 * with the quoting Node was not doing.
 *
 * The working version of this already existed in `mem-recall.js` — which is why
 * recall was the one memory script that handled a multi-word query. Its helper is
 * lifted here rather than reinvented, with the Windows quoting corrected.
 */

const { execSync } = require('node:child_process');

/**
 * Quote one argument for the platform's shell.
 *
 * `cmd.exe` and POSIX shells disagree about escaping inside double quotes, and
 * `mem-recall.js`'s original helper used the POSIX form (`\"`) on both. On
 * `cmd.exe` a backslash is not an escape character — an embedded double quote is
 * doubled (`""`) instead — so a title containing a quote was mangled there while
 * working on Linux. POSIX uses single quotes, which suppress every expansion
 * rather than just quoting the spaces.
 */
function quoteArg(value) {
  const raw = String(value);

  if (process.platform !== 'win32') {
    // End the quoted run, emit an escaped quote, reopen: '\'' is the standard
    // POSIX idiom, and single quotes stop $, ` and \ being interpreted at all.
    return `'${raw.split("'").join(`'\\''`)}'`;
  }

  // `cmd.exe` expands %NAME% even inside double quotes, and there is no escape
  // for `%` in a `cmd /c "..."` string — `%%` is a batch-file construct and
  // stays literal here. Rather than silently substituting an environment value
  // (or an empty string) into a memory title, drop the character and say so.
  let cmdSafe = raw;
  if (cmdSafe.includes('%')) {
    console.warn(`⚠ Removed '%' from a memvid argument: cmd.exe would expand it. Original: ${raw}`);
    cmdSafe = cmdSafe.split('%').join('');
  }

  return `"${cmdSafe.split('"').join('""')}"`;
}

/**
 * Run `memvid` with `args` passed as distinct arguments.
 *
 * Options are forwarded to `execSync`; `input` feeds stdin (the payload for
 * `put`), and `stdio`/`encoding` decide whether output is captured or inherited.
 */
function runMemvid(args, options = {}) {
  const command = `memvid ${args.map(quoteArg).join(' ')}`;
  return execSync(command, { windowsHide: true, ...options });
}

module.exports = { quoteArg, runMemvid };
