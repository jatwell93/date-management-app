#!/usr/bin/env node
/**
 * Advance every open per-change factory PR (OpenSpec change
 * factory-per-change-pr, task 1.2). Run hourly by the `route` job of
 * .github/workflows/factory.yml, after the router.
 *
 * A per-change PR moves on only when an event lands on it. An event can be
 * missed (GitHub drops some), and the quiet window ends with no event at all,
 * so a settled PR would sit idle. The sweep applies the router's step choice
 * (scripts/factory-route.js) to each open per-change PR:
 *
 *   babysit pass, task, owner task,  dispatch factory.yml with `pr`, which
 *                                    routes the same step again in its own run
 *     archive run
 *   archived on the branch           mark the PR ready (the router does it)
 *   waiting, finished, parked        nothing
 *
 * A PR is parked by `needs-human` on the PR or its tracking issue, and skipped
 * while the tracking issue has `factory-retry` or `factory-retrying` (the retry
 * check owns that run). A duplicate dispatch only queues in the change's
 * concurrency group and finds nothing left to do.
 *
 * Usage: node scripts/factory-sweep.js
 */
const { execFileSync } = require('node:child_process');

const { babysitRoute, changeFromLabels, defaultDeps } = require('./factory-route.js');

const DISPATCHED = new Set(['babysit', 'task', 'archive', 'escalate']);

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });

const sweepDeps = {
  ...defaultDeps,
  openAppPrs: () =>
    JSON.parse(
      gh(['pr', 'list', '--state', 'open', '--author', 'app/claude', '--json', 'number,labels']),
    ),
  retryingIssue: (id) => {
    const args = ['issue', 'list', '--state', 'open', '--label', `factory:${id}`];
    const list = JSON.parse(gh([...args, '--label', 'factory-retrying', '--json', 'number']));
    return list.length ? list[0].number : 0;
  },
  dispatch: (n) => gh(['workflow', 'run', 'factory.yml', '-f', `pr=${n}`]),
};

/** The step for one PR, or a reason it gets none. */
function sweepOne(pr, deps) {
  const id = changeFromLabels(pr.labels || []);
  if (!id || !deps.perChange(id)) return { mode: 'none', reason: 'not a per-change PR' };
  const retrying = deps.retryingIssue(id);
  if (retrying) return { mode: 'none', reason: `retry running: #${retrying}` };
  return babysitRoute(pr.number, deps);
}

function sweep(deps, log) {
  let dispatched = 0;
  for (const pr of deps.openAppPrs()) {
    const step = sweepOne(pr, deps);
    log(`#${pr.number}: ${step.mode} (${step.reason})`);
    if (!DISPATCHED.has(step.mode)) continue;
    deps.dispatch(pr.number);
    dispatched += 1;
  }
  return dispatched;
}

function main(deps = sweepDeps, log = console.log) {
  log(`dispatched ${sweep(deps, log)} run(s)`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { sweep, main };
