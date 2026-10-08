# Express + SQLite retirement: recovery commands

OpenSpec change `retire-express-unify-on-postgres`, task 4.0.

Phase 4 deletes `backend/` (Express, Prisma, SQLite) in one retirement commit. The Worker on
Neon Postgres is the deployed API and does not depend on it. This page records how to get the
deleted code back if a regression appears afterwards, and was tested while the tagged
revision was still present.

## The tag

`express-sqlite-last` is an annotated tag on the last `main` commit that still contains the
Express backend, the Prisma client and schema, and the SQLite runtime (commit `1731fa25`). It
was cut after the Express test suite passed on that commit.

```bash
git fetch --tags
git show express-sqlite-last --stat | head -20   # the commit the tag names, and its message
```

The tag is immutable by convention: never move or delete it. If it is missing locally, run
`git fetch --tags`. If it is ever missing on the remote, the commit it named is still reachable
from `main` history by SHA (`1731fa25`).

## What recovery means here

Express is not a serving path in production: the frontend talks to the Worker (the production
Pages build refuses to build unless `REACT_APP_API_URL` points at the production Worker).
Recovery is therefore about the **code**, not an outage procedure. There are three cases, from
least to most invasive.

### 1. Read or run the old behaviour side by side

Use a separate worktree so the working tree on `main` is untouched.

```bash
git worktree add --detach ../express-last express-sqlite-last
cd ../express-last
npm ci                                  # also runs `prepare` (tsc); takes a few minutes
(cd backend && npm ci)
(cd backend && npx prisma generate)     # required on a fresh checkout, or tests fail with
                                        # "@prisma/client did not initialize yet"
(cd backend && npm test)                # the Express suite, on SQLite (about 24 minutes in full)
```

If a native module fails to load (`better-sqlite3`, `bcrypt`), run
`npm rebuild better-sqlite3 bcrypt --prefix backend`. To check a single file quickly:
`cd backend && node scripts/run-tests.js run src/tests/unit/product.routes.test.ts`.

`npm ci --dry-run` at the root fails on a tree with no `node_modules` because the `prepare` hook
runs `tsc` even in a dry run; that is not a sign of a broken tree.

Run the old server with `cd backend && npm run dev`. Remove the worktree when done:
`git worktree remove ../express-last`.

Do **not** run `npm run test:prod` or `npm run test:both` in the worktree: they point at the
production Neon database. The Express suite (`npm test`) uses SQLite and is safe.

### 2. Get one file or directory back

Write it to a new name first, then compare and move it into place. Overwriting a path in place
from a ref discards any local edits to that path, and this repository's command guard blocks
those forms.

```bash
git show express-sqlite-last:backend/src/services/example.service.ts > example.service.ts.from-tag
git ls-tree -r --name-only express-sqlite-last backend/src/services/   # list a directory at the tag
```

Replace the path as needed. For a whole directory, use the worktree from case 1 and copy from it.

### 3. Undo the whole retirement

The retirement lands as one commit on `main` (squash merge). Find it and revert it:

```bash
git log --oneline --diff-filter=D -- backend/package.json   # the commit that deleted the backend
git revert <retirement-sha>                                  # on a new branch off main
```

If the retirement was a merge commit, use `git revert -m 1 <merge-sha>`. Reverting restores
`backend/`, the root and workspace `package.json` and lockfile entries, the deleted scripts and
the workflow files in one step. Then reinstall as in case 1. Expect conflicts only if the same
files were edited after the retirement; resolve them by taking the tagged version of anything
under `backend/`.

After a revert, `.github/workflows/backend-test.yml` runs again and the root `test:backend*`
commands work again. The Worker, the frontend and the Neon migrations are unaffected by the
revert.

## Verification record

Run on 2026-10-08 against `express-sqlite-last` (commit `1731fa25`):

- Express suite at the tag commit: 176 test files and 2020 tests passed, 9 skipped (1454 s).
- Case 1: a fresh detached worktree at the tag ran `npm ci` (root and `backend/`), failed the
  first test with "@prisma/client did not initialize yet" until `npx prisma generate` was run
  (now in the steps above), then passed `product.routes.test.ts` (42 tests) through
  `backend/scripts/run-tests.js`.
- Case 2: after `backend/` had been deleted on a throwaway commit, `git show
  express-sqlite-last:backend/src/index.ts` written to a new file hashed to the tag's blob
  (`afe9693b00ec0c21aef4af086463e7025f14347c`). The tag lists 473 files under `backend/`.
- Case 3: on a detached worktree, deleting `backend/` in one commit and running
  `git revert --no-edit HEAD` left `git diff express-sqlite-last HEAD --stat` empty, with
  `backend/` back (27 top-level entries, as at the tag).
