#!/usr/bin/env node
/**
 * Collect the review feedback on one pull request, so an agent can work
 * through it without the user pasting bot comments into the session.
 *
 * Feedback arrives from three places, and GitHub's REST API splits them:
 *
 *   * Sentry (Seer) and Copilot post inline review threads. Sentry resolves
 *     its own thread when a later commit fixes the issue ("Resolved in
 *     <sha>"), so only UNRESOLVED threads are actionable.
 *   * CodeScene posts a review per push: APPROVED when its gates pass,
 *     CHANGES_REQUESTED when they fail, plus inline threads for code smells.
 *   * Humans can do any of the above, or leave a plain issue comment.
 *
 * GraphQL is the only API that exposes `isResolved` on a thread, so one
 * GraphQL query reads all three; `gh pr checks` adds the CI state.
 *
 * Usage:
 *   node scripts/pr-feedback.js <pr> [--quiet-minutes N]   # JSON report
 *   node scripts/pr-feedback.js reply <threadId> <body>     # reply in a thread
 *   node scripts/pr-feedback.js resolve <threadId>          # resolve a thread
 *
 * The report's `settled` flag is true when every check has finished and no
 * feedback or commit is newer than the quiet window (default 10 minutes).
 * Seer posts several minutes after a push, so "checks are green" alone does
 * not mean the reviews are in.
 */

const { execFileSync } = require('node:child_process');

const DEFAULT_QUIET_MINUTES = 10;
const BODY_LIMIT = 4000;

const QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number
      state
      url
      headRefName
      commits(last: 1) { nodes { commit { oid committedDate } } }
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 50) {
            nodes { author { login } createdAt url body }
          }
        }
      }
      reviews(last: 50) {
        nodes { author { login } state submittedAt url body }
      }
      comments(last: 50) {
        nodes { author { login } createdAt url body }
      }
    }
  }
}`;

function defaultGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function clip(body) {
  const text = (body || '').trim();
  return text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}\n…[truncated]` : text;
}

function login(node) {
  return node?.author?.login || 'ghost';
}

function latestTime(times) {
  const valid = times
    .filter(Boolean)
    .map((t) => Date.parse(t))
    .filter(Number.isFinite);
  return valid.length ? new Date(Math.max(...valid)).toISOString() : null;
}

/** Map `gh pr checks --json name,bucket` rows to pass/fail/pending counts. */
function summarizeChecks(rows) {
  const summary = { pass: 0, fail: [], pending: [], skipped: 0 };
  for (const row of rows || []) {
    if (row.bucket === 'pass') summary.pass += 1;
    else if (row.bucket === 'fail' || row.bucket === 'cancel') summary.fail.push(row.name);
    else if (row.bucket === 'skipping') summary.skipped += 1;
    else summary.pending.push(row.name);
  }
  return summary;
}

/**
 * Reduce the GraphQL pull request and the checks rows to what an agent acts
 * on. Pure, so the tests can drive it with fixtures.
 */
function summarize(pr, checkRows, { now = Date.now(), quietMinutes = DEFAULT_QUIET_MINUTES } = {}) {
  const head = pr.commits?.nodes?.[0]?.commit || {};

  const threads = (pr.reviewThreads?.nodes || [])
    .filter((t) => !t.isResolved)
    .map((t) => {
      const comments = t.comments?.nodes || [];
      const first = comments[0] || {};
      return {
        id: t.id,
        author: login(first),
        path: t.path,
        line: t.line,
        outdated: t.isOutdated,
        url: first.url,
        createdAt: first.createdAt,
        body: clip(first.body),
        replies: comments.slice(1).map((c) => ({ author: login(c), body: clip(c.body) })),
      };
    });

  // Only the latest review per author matters: CodeScene re-reviews every push.
  const latestReview = new Map();
  for (const r of pr.reviews?.nodes || []) {
    const prev = latestReview.get(login(r));
    if (!prev || Date.parse(r.submittedAt) >= Date.parse(prev.submittedAt))
      latestReview.set(login(r), r);
  }
  const reviews = [...latestReview.values()].map((r) => ({
    author: login(r),
    state: r.state,
    submittedAt: r.submittedAt,
    url: r.url,
    actionable: r.state === 'CHANGES_REQUESTED',
    body: clip(r.body),
  }));

  const comments = (pr.comments?.nodes || []).map((c) => ({
    author: login(c),
    createdAt: c.createdAt,
    url: c.url,
    body: clip(c.body),
  }));

  const checks = summarizeChecks(checkRows);
  const lastActivityAt = latestTime([
    head.committedDate,
    ...(pr.reviewThreads?.nodes || []).flatMap((t) =>
      (t.comments?.nodes || []).map((c) => c.createdAt),
    ),
    ...(pr.reviews?.nodes || []).map((r) => r.submittedAt),
    ...comments.map((c) => c.createdAt),
  ]);
  const quietFor = lastActivityAt ? (now - Date.parse(lastActivityAt)) / 60000 : Infinity;
  const settled = checks.pending.length === 0 && quietFor >= quietMinutes;

  return {
    pr: pr.number,
    state: pr.state,
    url: pr.url,
    branch: pr.headRefName,
    head: head.oid,
    checks,
    settled,
    lastActivityAt,
    unresolvedThreads: threads,
    reviews,
    comments,
    actionable: threads.length + reviews.filter((r) => r.actionable).length + checks.fail.length,
  };
}

function repoSlug(gh) {
  const [owner, repo] = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
    .trim()
    .split('/');
  return { owner, repo };
}

function fetchReport(number, { gh = defaultGh, now, quietMinutes } = {}) {
  const { owner, repo } = repoSlug(gh);
  const raw = gh([
    'api',
    'graphql',
    '-f',
    `query=${QUERY}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `repo=${repo}`,
    '-F',
    `number=${number}`,
  ]);
  const pr = JSON.parse(raw).data.repository.pullRequest;
  let checkRows = [];
  try {
    checkRows = JSON.parse(gh(['pr', 'checks', String(number), '--json', 'name,bucket']));
  } catch (err) {
    // `gh pr checks` exits 8 while checks are pending and 1 when one failed,
    // but still prints the JSON on stdout.
    if (err.stdout) checkRows = JSON.parse(err.stdout);
    else throw err;
  }
  return summarize(pr, checkRows, { now, quietMinutes });
}

function reply(threadId, body, { gh = defaultGh } = {}) {
  gh([
    'api',
    'graphql',
    '-f',
    'query=mutation($id: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) { comment { url } } }',
    '-F',
    `id=${threadId}`,
    '-f',
    `body=${body}`,
  ]);
}

function resolve(threadId, { gh = defaultGh } = {}) {
  gh([
    'api',
    'graphql',
    '-f',
    'query=mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }',
    '-F',
    `id=${threadId}`,
  ]);
}

function main(argv, { gh = defaultGh, out = process.stdout } = {}) {
  const [cmd, ...rest] = argv;
  if (cmd === 'reply' && rest.length >= 2) {
    reply(rest[0], rest.slice(1).join(' '), { gh });
    return 0;
  }
  if (cmd === 'resolve' && rest.length === 1) {
    resolve(rest[0], { gh });
    return 0;
  }
  if (/^\d+$/.test(cmd || '')) {
    const i = rest.indexOf('--quiet-minutes');
    const quietMinutes = i >= 0 ? Number(rest[i + 1]) : DEFAULT_QUIET_MINUTES;
    out.write(`${JSON.stringify(fetchReport(Number(cmd), { gh, quietMinutes }), null, 2)}\n`);
    return 0;
  }
  process.stderr.write(
    'usage: pr-feedback.js <pr> [--quiet-minutes N] | reply <threadId> <body> | resolve <threadId>\n',
  );
  return 2;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { summarize, summarizeChecks, fetchReport, reply, resolve, main, QUERY };
