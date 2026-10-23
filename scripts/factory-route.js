#!/usr/bin/env node
/**
 * Decide what one GitHub event means for the factory (OpenSpec change
 * add-spec-factory-runner, tasks 2.1 and 2.2). Run by the `route` job of
 * .github/workflows/factory.yml; prints $GITHUB_OUTPUT lines:
 *
 *   mode=task|babysit|none  change_id=<id>  pr=<n>  ref=<branch>  reason=<text>
 *
 *   workflow_dispatch(change_id)    task on that change
 *   pull_request closed, merged     task on the next unchecked task of the change
 *   pull_request_review(_comment),  babysit pass on the PR, when it has work the
 *   workflow_dispatch(pr)           factory has not handled yet and no Actions
 *     (a finished CI run, relayed   check pending
 *     by factory-ci-relay.yml)
 *
 * Only PRs authored by the Claude GitHub App AND labelled `factory:<id>` count:
 * the factory can edit labels, so a label alone must never point the factory
 * at an owner's branch. Deciding "nothing to do" here, before the Claude step,
 * keeps most events from spending a Claude run.
 *
 * Usage: node scripts/factory-route.js   (reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH)
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const FACTORY_AUTHOR = 'claude[bot]';
const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

const none = (reason) => ({ mode: 'none', reason });

/** The change id from a `factory:<id>` label, or ''. */
function changeFromLabels(labels) {
  const ids = labels
    .map((l) => (typeof l === 'string' ? l : l.name))
    .filter((l) => l.startsWith('factory:'))
    .map((l) => l.slice('factory:'.length))
    .filter((id) => id !== 'run' && CHANGE_ID.test(id));
  return ids[0] || '';
}

const authorOf = (pr) => pr.user?.login || pr.author?.login || '';
const isAppAuthor = (login) => login === FACTORY_AUTHOR || login === 'app/claude';

function dispatchRoute(event) {
  const id = event.inputs?.change_id || '';
  if (!CHANGE_ID.test(id)) return none('invalid change_id');
  return { mode: 'task', change_id: id, reason: 'dispatched' };
}

function mergedRoute(event) {
  const pr = event.pull_request || {};
  if (event.action !== 'closed' || !pr.merged) return none('not a merge');
  const id = changeFromLabels(pr.labels || []);
  if (!id || !isAppAuthor(authorOf(pr))) return none('not a factory PR');
  return { mode: 'task', change_id: id, reason: `#${pr.number} merged` };
}

/**
 * PR number the event is about, or 0. A finished CI run reaches this workflow
 * as a dispatch with `inputs.pr` (from .github/workflows/factory-ci-relay.yml),
 * so this workflow never checks out PR code under workflow_run.
 */
function prNumberOf(event) {
  if (event.pull_request) return event.pull_request.number;
  const input = String(event.inputs?.pr || '');
  return /^[1-9][0-9]*$/.test(input) ? Number(input) : 0;
}

const isFactoryPr = (pr, id) => pr.state === 'OPEN' && Boolean(id) && isAppAuthor(authorOf(pr));

/** Why an open PR is not one the factory may babysit now, or ''. */
function prBlocker(pr, id) {
  if (!isFactoryPr(pr, id)) return 'not an open factory PR';
  const parked = (pr.labels || []).some((l) => l.name === 'needs-human');
  return parked ? 'waiting on the owner' : '';
}

// GraphQL gives an app's login without the [bot] suffix.
const FACTORY_LOGINS = new Set(['claude', 'claude[bot]', 'app/claude']);

/** Threads whose last word is not the factory's: it has not answered them yet. */
const awaitingThreads = (threads) =>
  threads.filter((t) => !FACTORY_LOGINS.has((t.replies.at(-1) || t).author));

/**
 * Reviews posted since the head commit. An older actionable review (a human's
 * CHANGES_REQUESTED, say) was already seen by the pass that made that commit;
 * counting it again would start a pass on every later event.
 */
const freshReviews = (reviews, headCommittedAt) =>
  reviews.filter(
    (r) => r.actionable && Date.parse(r.submittedAt) > Date.parse(headCommittedAt || 0),
  );

/** Items a pass has not handled yet: unanswered threads, new reviews, failing checks. */
function pendingWork(report) {
  return (
    awaitingThreads(report.unresolvedThreads || []).length +
    freshReviews(report.reviews || [], report.headCommittedAt).length +
    report.checks.fail.length
  );
}

/** Why the PR's feedback gives a pass nothing to do yet, or ''. */
function feedbackBlocker(report) {
  if (report.checks.pendingActions.length) return 'Actions checks still running';
  return pendingWork(report) ? '' : 'nothing actionable';
}

/** A babysit pass, if the open factory PR has something to act on now. */
function babysitRoute(number, deps) {
  if (!number) return none('no pull request');
  const pr = deps.prView(number);
  const id = changeFromLabels(pr.labels || []);
  const blocked = prBlocker(pr, id) || feedbackBlocker(deps.feedback(number));
  if (blocked) return none(blocked);
  return { mode: 'babysit', change_id: id, pr: number, ref: pr.headRefName, reason: 'actionable' };
}

/** A task on a change that is not (or no longer) active becomes `none`. */
function activeOnly(result, deps) {
  if (result.mode !== 'task' || deps.changeExists(result.change_id)) return result;
  return none(`${result.change_id} has no tasks.md (archived or missing)`);
}

function route(eventName, event, deps) {
  const relayedPr = eventName === 'workflow_dispatch' && event.inputs?.pr;
  if (relayedPr) return babysitRoute(prNumberOf(event), deps);
  if (eventName === 'workflow_dispatch') return activeOnly(dispatchRoute(event), deps);
  if (eventName === 'pull_request') return activeOnly(mergedRoute(event), deps);
  return babysitRoute(prNumberOf(event), deps);
}

/** $GITHUB_OUTPUT lines; values are ids, numbers and branch names only. */
function toOutput(result) {
  const keys = ['mode', 'change_id', 'pr', 'ref', 'reason'];
  return keys.map((k) => `${k}=${String(result[k] ?? '').replace(/[\r\n]/g, ' ')}`).join('\n');
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });

const defaultDeps = {
  changeExists: (id) => fs.existsSync(`openspec/changes/${id}/tasks.md`),
  prView: (n) =>
    JSON.parse(gh(['pr', 'view', String(n), '--json', 'state,labels,author,headRefName'])),
  feedback: (n) =>
    JSON.parse(execFileSync('node', ['scripts/pr-feedback.js', String(n)], { encoding: 'utf8' })),
};

function main(env = process.env, deps = defaultDeps, log = console.log) {
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  log(toOutput(route(env.GITHUB_EVENT_NAME, event, deps)));
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { changeFromLabels, route, toOutput, main };
