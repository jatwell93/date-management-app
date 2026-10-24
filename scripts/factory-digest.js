#!/usr/bin/env node
/**
 * Post the factory's daily digest (OpenSpec change add-spec-factory-runner,
 * task 3.2) as one comment on the `Factory digest` issue: what waits on the
 * owner (`needs-human`), the open factory PRs with their pr-feedback verdict,
 * and factory runs that failed in the last day. Run by
 * .github/workflows/factory-digest.yml; posts nothing when all three are empty.
 *
 * Usage: node scripts/factory-digest.js [--dry-run]   (--dry-run prints the body)
 */
const { execFileSync } = require('node:child_process');

const { changeFromLabels } = require('./factory-route.js');

const OWNER = '@jatwell93';
// A label without the `factory:` prefix, so the router never reads it as a change id.
const DIGEST_LABEL = 'factory-digest';
const DAY_MS = 24 * 60 * 60 * 1000;

const json = (deps, args) => JSON.parse(deps.gh(args));

/** Open issues and PRs labelled needs-human. */
function parked(deps) {
  const args = ['list', '--state', 'open', '--label', 'needs-human', '--json', 'number,title,url'];
  return [...json(deps, ['issue', ...args]), ...json(deps, ['pr', ...args])];
}

/** Open PRs the Claude GitHub App authored with a `factory:<id>` label. */
function factoryPrs(deps) {
  const args = ['pr', 'list', '--state', 'open', '--author', 'app/claude'];
  const prs = json(deps, [...args, '--json', 'number,title,url,labels']);
  return prs
    .filter((pr) => changeFromLabels(pr.labels))
    .map((pr) => ({ ...pr, summary: deps.summary(pr.number) }));
}

function failedRuns(deps, now) {
  const since = new Date(now - DAY_MS).toISOString();
  const args = ['run', 'list', '--workflow', 'factory.yml', '--status', 'failure'];
  return json(deps, [...args, '--created', `>=${since}`, '--json', 'url,displayTitle']);
}

function collect(deps, now) {
  return { parked: parked(deps), prs: factoryPrs(deps), failed: failedRuns(deps, now) };
}

const isEmpty = (d) => !d.parked.length && !d.prs.length && !d.failed.length;

function section(title, items, line) {
  if (!items.length) return [];
  return [`**${title}**`, '', ...items.map(line), ''];
}

/** Markdown body of the digest comment. */
function format(digest, now) {
  return [
    `Factory digest, ${new Date(now).toISOString().slice(0, 10)}. ${OWNER}`,
    '',
    ...section('Waiting on you (needs-human)', digest.parked, (i) => `- #${i.number} ${i.title}`),
    ...section(
      'Open factory PRs',
      digest.prs,
      (p) => `- #${p.number} ${p.title}: \`${p.summary}\``,
    ),
    ...section(
      'Failed factory runs, last 24 hours',
      digest.failed,
      (r) => `- ${r.displayTitle}: ${r.url}`,
    ),
  ].join('\n');
}

/** The open digest issue, created on first use. */
function digestIssue(deps) {
  const args = ['issue', 'list', '--state', 'open', '--label', DIGEST_LABEL, '--json', 'number'];
  const open = json(deps, args);
  if (open.length) return open[0].number;
  deps.gh([
    'label',
    'create',
    DIGEST_LABEL,
    '--force',
    '--color',
    'BFD4F2',
    '--description',
    'Daily factory digest',
  ]);
  const url = deps.gh([
    'issue',
    'create',
    '--title',
    'Factory digest',
    '--label',
    DIGEST_LABEL,
    '--body',
    'One comment a day from .github/workflows/factory-digest.yml.',
  ]);
  return Number(url.trim().split('/').pop());
}

const defaultDeps = {
  gh: (args) => execFileSync('gh', args, { encoding: 'utf8' }),
  summary: (n) =>
    execFileSync('node', ['scripts/pr-feedback.js', String(n), '--summary'], {
      encoding: 'utf8',
    }).trim(),
};

function main(
  argv = process.argv.slice(2),
  deps = defaultDeps,
  log = console.log,
  now = Date.now(),
) {
  const digest = collect(deps, now);
  if (isEmpty(digest)) {
    log('Nothing open: no digest posted.');
    return 0;
  }
  const body = format(digest, now);
  if (argv.includes('--dry-run')) {
    log(body);
    return 0;
  }
  const issue = digestIssue(deps);
  deps.gh(['issue', 'comment', String(issue), '--body', body]);
  log(`Digest posted on #${issue}.`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { format, isEmpty, main };
