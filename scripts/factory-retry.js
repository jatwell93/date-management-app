#!/usr/bin/env node
/**
 * Record a factory run's outcome for the retry-once rule (OpenSpec change
 * factory-one-merge-per-change, task 5.4). Run by the `report` job of
 * .github/workflows/factory.yml after every Claude run that failed or succeeded
 * (a cancelled run does nothing).
 *
 *   fail <id> <run-url>   first failure: label the tracking issue factory-retry
 *                         and comment the run link; the hourly scheduled route
 *                         retries it once the label is an hour old.
 *                         Failure while the issue has factory-retrying (the
 *                         retry failed too): remove that label, add needs-human
 *                         and comment both run links.
 *   ok <id>               a run succeeded: remove factory-retrying, if present,
 *                         so a later failure gets its own retry.
 *
 * Usage: node scripts/factory-retry.js fail <change-id> <run-url>
 *        node scripts/factory-retry.js ok <change-id>
 * Exit codes: 0 done, 2 usage error.
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const { factoryIdProblem } = require('./factory-route.js');
const { trackingIssue } = require('./factory-issue.js');
const { OWNER } = require('./factory-escalate.js');

const RETRY = 'factory-retry';
const RETRYING = 'factory-retrying';
const RUN_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/[0-9]+$/;
// The first failure's comment carries its run link, so a failed retry can cite both.
const MARKER = /<!-- factory-retry run: (\S+) -->/;

/** Why the arguments are unusable, or ''. */
function usageProblem(command, id, url) {
  if (command !== 'fail' && command !== 'ok') return 'command must be fail or ok';
  if (factoryIdProblem(id)) return factoryIdProblem(id);
  if (command === 'fail' && !RUN_URL.test(url)) return 'invalid run url';
  return '';
}

const labelNames = (issue) => (issue.labels || []).map((l) => l.name);

function ensureLabels(gh) {
  for (const [name, description] of [
    [RETRY, 'Factory run failed; retried once an hour later'],
    [RETRYING, 'Factory retry in progress; another failure escalates'],
  ]) {
    gh(['label', 'create', name, '--force', '--color', 'FBCA04', '--description', description]);
  }
}

/** Run link from the newest marker comment on the issue, or ''. */
function firstRunLink(issue) {
  const marked = (issue.comments || []).map((c) => MARKER.exec(c.body || '')).filter(Boolean);
  return marked.length ? marked.at(-1)[1] : '';
}

function fail(id, url, deps, log) {
  const number = String(trackingIssue(id, deps));
  const issue = JSON.parse(deps.gh(['issue', 'view', number, '--json', 'labels,comments']));
  if (labelNames(issue).includes(RETRYING)) {
    const first = firstRunLink(issue) || '(link not found)';
    deps.gh(['issue', 'edit', number, '--remove-label', RETRYING, '--add-label', 'needs-human']);
    deps.gh([
      'issue',
      'comment',
      number,
      '--body',
      [
        `${OWNER} A run of \`${id}\` failed, and so did its retry:`,
        '',
        `- first: ${first}`,
        `- retry: ${url}`,
        '',
        'The factory will not retry again. Look at the runs, fix the cause, then remove `needs-human` to resume.',
      ].join('\n'),
    ]);
    log(`Retry of ${id} failed; escalated on #${number}.`);
    return 0;
  }
  ensureLabels(deps.gh);
  deps.gh(['issue', 'edit', number, '--add-label', RETRY]);
  deps.gh([
    'issue',
    'comment',
    number,
    '--body',
    `A factory run of \`${id}\` failed: ${url}\n\nIt is retried once, an hour after this label was added.\n\n<!-- factory-retry run: ${url} -->`,
  ]);
  log(`Run of ${id} failed; #${number} labelled ${RETRY}.`);
  return 0;
}

function ok(id, deps, log) {
  const args = ['issue', 'list', '--state', 'open', '--label', `factory:${id}`];
  const list = JSON.parse(deps.gh([...args, '--label', RETRYING, '--json', 'number']));
  for (const { number } of list) {
    deps.gh(['issue', 'edit', String(number), '--remove-label', RETRYING]);
    log(`Run of ${id} succeeded; removed ${RETRYING} from #${number}.`);
  }
  return 0;
}

const defaultDeps = {
  gh: (args) => execFileSync('gh', args, { encoding: 'utf8' }),
  proposal: (id) => {
    const file = `openspec/changes/${id}/proposal.md`;
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  },
};

function main(argv = process.argv.slice(2), deps = defaultDeps, log = console.log) {
  const [command, id, url] = [...argv, '', '', ''];
  const problem = usageProblem(command, id, url);
  if (problem) {
    console.error(
      `usage: factory-retry.js fail <change-id> <run-url> | ok <change-id>: ${problem}`,
    );
    return 2;
  }
  return command === 'fail' ? fail(id, url, deps, log) : ok(id, deps, log);
}

if (require.main === module) process.exitCode = main();

module.exports = { RETRY, RETRYING, main };
