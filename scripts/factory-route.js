#!/usr/bin/env node
/**
 * Decide what one GitHub event means for the factory (OpenSpec change
 * add-spec-factory-runner, tasks 2.1 and 2.2). Run by the `route` job of
 * .github/workflows/factory.yml; prints $GITHUB_OUTPUT lines:
 *
 *   mode=task|babysit|archive|escalate|none  change_id=<id>  pr=<n>  ref=<branch>
 *   task=<n>  retry=<issue>  per_change=true|  reason=<text>
 *
 *   workflow_dispatch(change_id)    task on that change
 *   pull_request closed, merged     task on the next unchecked task of the change
 *     (a factory PR, or a plan PR   (a plan PR: factory-tickets-and-autostart 4.2)
 *     labelled factory-ready that
 *     the owner merged)
 *   issues unlabeled needs-human    task: the owner answered an escalation (3.1)
 *     (by the owner, on an issue
 *     labelled factory:<id>)
 *   issues labeled factory-ready    task: the owner approved the plan and starts
 *     (same conditions)             the change (factory-tickets-and-autostart 4.1)
 *
 *   schedule (hourly)               the one retry of a failed run (5.4): babysit
 *                                   if the change has an open factory PR, else task
 *
 * Every route becomes `none` while the change's tracking issue has
 * `needs-human` or `factory-retry` (scripts/factory-issue.js finds that issue), and `escalate`
 * when the next unchecked task is marked `(owner)`: the escalate job asks the
 * owner without a Claude run (factory-one-merge-per-change, task 5.1).
 *   pull_request_review(_comment),  babysit pass on the PR, when it has work the
 *   workflow_dispatch(pr)           factory has not handled yet and no Actions
 *     (a finished CI run, relayed   check pending
 *     by factory-ci-relay.yml)
 *
 *
 * A change with `pr: per-change` in its Autonomy block keeps every task on one
 * PR (factory-per-change-pr, task 1.2). Every route that lands on that PR
 * advances it by one step: a babysit pass on actionable items, else, once the
 * PR is settled, the next task of the branch's tasks.md (escalated if it is an
 * `(owner)` task), else an archive run that commits the archived change on
 * the PR, else marking the PR ready for the owner. A merge of the archived PR
 * starts nothing: the change is complete.
 *
 * A change with no unchecked task left on main and not yet archived routes
 * `mode: archive` (factory-tickets-and-autostart, task 5.1): a Claude run that
 * archives it on one archive PR. An archived change (no
 * openspec/changes/<id>/tasks.md) routes to nothing.
 *
 * Only PRs authored by the Claude GitHub App AND labelled `factory:<id>` count
 * as factory PRs, which the factory babysits and continues: the factory can
 * edit labels, so a label alone must never point the factory at an owner's
 * branch. The one exception is a plan PR (task 4.2): its labels count only once
 * the owner has merged it, and it starts a task from main, never from its
 * branch. Deciding "nothing to do" here, before the Claude step,
 * keeps most events from spending a Claude run.
 *
 * Usage: node scripts/factory-route.js   (reads GITHUB_EVENT_NAME, GITHUB_EVENT_PATH)
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const FACTORY_AUTHOR = 'claude[bot]';
const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
// GitHub caps label names at 50 characters, and every factory PR and tracking
// issue carries `factory:<id>`, so a longer id cannot run through the factory.
const MAX_FACTORY_ID = 50 - 'factory:'.length;

const none = (reason) => ({ mode: 'none', reason });

/** Why an id cannot run through the factory, or ''. */
function factoryIdProblem(id) {
  if (!CHANGE_ID.test(id)) return 'invalid change_id';
  if (id.length > MAX_FACTORY_ID) {
    return `change id is ${id.length} characters; factory:<id> labels allow ${MAX_FACTORY_ID}. Rename the change folder`;
  }
  return '';
}

const TASK_NUMBER = /^[0-9][0-9A-Za-z.]{0,19}$/;

/**
 * The first unchecked numbered task of a tasks.md, as { number, text, owner },
 * or null. Unnumbered checkboxes (sub-items, notes) are skipped. `owner` is true
 * when `(owner)` follows the task number.
 */
function nextTask(tasksMd) {
  const m = (tasksMd || '')
    .split(/\r?\n/)
    .map((l) => /^\s*- \[ \] (\S+)\s+(.*)$/.exec(l))
    .find((x) => x && TASK_NUMBER.test(x[1]));
  if (!m) return null;
  const owner = /^\(owner\)(\s|$)/.test(m[2]);
  return { number: m[1], text: m[2].replace(/^\(owner\)\s*/, ''), owner };
}

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
  const problem = factoryIdProblem(id);
  if (problem) return none(problem);
  return { mode: 'task', change_id: id, reason: 'dispatched' };
}

function mergedRoute(event, deps) {
  const pr = event.pull_request || {};
  if (event.action !== 'closed' || !pr.merged) return none('not a merge');
  const id = changeFromLabels(pr.labels || []);
  if (!id) return none('not a factory PR');
  if (!isAppAuthor(authorOf(pr))) return planMergedRoute(event, id, deps);
  // activeOnly decides what the merge starts: nothing once the change is
  // archived on main, else its next task, else an archive run. A per-change
  // PR merged before its last task (the owner merged a WIP: PR) carries on:
  // the next task opens a new per-change PR.
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

/**
 * Why the change's tracking issue holds every Claude run, or '': `needs-human`
 * (waiting on the owner, task 3.1) or `factory-retry` (a failed run waiting for
 * its retry, task 5.4).
 */
function changeHold(id, deps) {
  const parked = deps.parkedIssue(id);
  if (parked) return `waiting on the owner: #${parked} has needs-human`;
  const retry = deps.retryIssue(id);
  return retry ? `waiting to retry: #${retry} has factory-retry` : '';
}

/**
 * A babysit pass, if the open factory PR has something to act on now. A
 * per-change PR advances by one step instead (advanceRoute).
 */
function babysitRoute(number, deps) {
  if (!number) return none('no pull request');
  const pr = deps.prView(number);
  const id = changeFromLabels(pr.labels || []);
  const held = prBlocker(pr, id) || changeHold(id, deps);
  if (held) return none(held);
  if (deps.perChange(id)) return advanceRoute(number, pr, id, deps);
  const blocked = feedbackBlocker(deps.feedback(number));
  if (blocked) return none(blocked);
  return { mode: 'babysit', change_id: id, pr: number, ref: pr.headRefName, reason: 'actionable' };
}

/** True while a per-change PR still has tasks to come: a draft or a `WIP:` title. */
const isWip = (pr) => Boolean(pr.isDraft) || /^WIP:/i.test(pr.title || '');

/**
 * One step on a per-change PR, chosen from its state now: a babysit pass on
 * actionable items; nothing while it waits (checks running, quiet window);
 * else the next task on its branch.
 */
function advanceRoute(number, pr, id, deps) {
  const report = deps.feedback(number);
  const base = { change_id: id, pr: number, ref: pr.headRefName, per_change: true };
  if (report.checks.pendingActions.length) return none('Actions checks still running');
  if (pendingWork(report)) return { mode: 'babysit', ...base, reason: 'actionable' };
  if (!report.settled) return none(`waiting on ${(report.waitingOn || []).join(', ')}`);
  return nextStepRoute(pr, base, deps);
}

/**
 * On a settled per-change PR: the branch's next task (escalated if it is the
 * owner's), else an archive run on the PR (factory-tickets-and-autostart,
 * task 5.1), else, once the branch holds the archived change, mark the PR
 * ready and tell the owner, once. The archived branch has no
 * openspec/changes/<id>/tasks.md, so it is checked first.
 */
function nextStepRoute(pr, base, deps) {
  if (deps.branchArchived(base.change_id, pr.headRefName)) return handOverRoute(pr, base, deps);
  const task = deps.branchTask(base.change_id, pr.headRefName);
  if (task && task.owner) return { ...ownerTaskRoute(base, task), ref: base.ref, per_change: true };
  if (task)
    return {
      mode: 'task',
      ...base,
      task: task.number,
      reason: `task ${task.number} on #${base.pr}`,
    };
  return { mode: 'archive', ...base, reason: `archive ${base.change_id} on #${base.pr}` };
}

/** A finished, archived per-change PR: mark it ready for the owner, once. */
function handOverRoute(pr, base, deps) {
  if (!isWip(pr)) return none(`#${base.pr} is finished: waiting for the owner's merge`);
  deps.markReady(pr, base.pr);
  return none(`#${base.pr} marked ready for the owner`);
}

/**
 * Every task of a change is done on main and it is not archived yet: one
 * archive run, which opens an archive PR (task 5.1). While a factory PR of the
 * change is open, its own events drive it.
 */
function archiveRoute(id, deps) {
  const open = deps.openFactoryPr(id);
  if (open) return none(`${id} is already running on #${open}`);
  return { mode: 'archive', change_id: id, reason: `every task of ${id} is done` };
}

/** True when an archive folder name is change `id`'s: `<YYYY-MM-DD>-<id>`. */
const isArchiveOf = (name, id) =>
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}-/.test(name) && name.slice(11) === id;

/**
 * The owner taking `needs-human` off a change's tracking issue resumes it.
 * Only the owner: the factory can edit labels too, and must not unpark itself.
 */
function resumeRoute(event) {
  const issue = event.issue || {};
  const id = changeFromLabels(issue.labels || []);
  const blocked = resumeBlocker(event, id);
  if (blocked) return none(blocked);
  return { mode: 'task', change_id: id, reason: `#${issue.number} resumed by the owner` };
}

/** The label the owner adds to a tracking issue to start its change. */
const READY_LABEL = 'factory-ready';

/**
 * The owner adding `factory-ready` to a change's tracking issue starts its
 * first unchecked task, as a dispatch does (factory-tickets-and-autostart,
 * task 4.1). The label is not `factory:ready`: changeFromLabels would read
 * that as the change id `ready`. A change with an open factory PR is already
 * running, and its PR's own events drive it.
 */
function readyRoute(event, deps) {
  const issue = event.issue || {};
  const id = changeFromLabels(issue.labels || []);
  const blocked = readyBlocker(event, id);
  if (blocked) return none(blocked);
  const open = deps.openFactoryPr(id);
  if (open) return none(`${id} is already running on #${open}`);
  return { mode: 'task', change_id: id, reason: `#${issue.number} marked ready by the owner` };
}

/** Why a `labeled` event does not start a change, or ''. */
function readyBlocker(event, id) {
  if ((event.label || {}).name !== READY_LABEL) return `not a ${READY_LABEL} label`;
  if (!id) return 'not a tracking issue';
  return sentByOwner(event) ? '' : `${READY_LABEL} added by someone other than the owner`;
}

/**
 * The owner merging a plan PR starts its change (factory-tickets-and-autostart,
 * task 4.2). to-tickets opens that PR labelled `factory:<id>` and
 * `factory-ready`; its merge puts tasks.md on main, where the router reads it,
 * so the merge rather than a label on the tracking issue starts the build.
 * Whoever authored the PR, only the owner's merge counts.
 */
function planMergedRoute(event, id, deps) {
  const pr = event.pull_request;
  if (!hasLabel(pr, READY_LABEL)) return none('not a factory PR');
  if (!mergedByOwner(event))
    return none(`plan #${pr.number} merged by someone other than the owner`);
  const open = deps.openFactoryPr(id);
  if (open) return none(`${id} is already running on #${open}`);
  return { mode: 'task', change_id: id, reason: `plan #${pr.number} merged by the owner` };
}

const hasLabel = (item, name) =>
  (item.labels || []).some((l) => (typeof l === 'string' ? l : l.name) === name);

/** True when the owner merged the event's PR. */
const mergedByOwner = ({ pull_request, repository = {} }) =>
  sentByOwner({ sender: pull_request.merged_by || {}, repository });

/** An `issues` event: the owner starting a change, or resuming one. */
const issuesRoute = (event, deps) =>
  event.action === 'labeled' ? readyRoute(event, deps) : resumeRoute(event);

/** True when the event's sender is the repository owner. */
function sentByOwner({ sender = {}, repository = {} }) {
  const owner = (repository.owner || {}).login;
  return Boolean(owner) && sender.login === owner;
}

/** Why an `issues` event does not resume a change, or ''. */
function resumeBlocker(event, id) {
  const removedLabel = event.action === 'unlabeled' ? (event.label || {}).name : '';
  if (removedLabel !== 'needs-human') return 'not a needs-human removal';
  if (!id) return 'not a tracking issue';
  return sentByOwner(event) ? '' : 'needs-human removed by someone other than the owner';
}

/**
 * A task on a change that is not (or no longer) active, or whose tracking issue
 * waits on the owner (task 3.1), becomes `none`. Later tasks wait for the answer.
 */
function activeOnly(result, deps) {
  if (result.mode !== 'task') return result;
  if (!deps.changeExists(result.change_id)) {
    return none(`${result.change_id} has no tasks.md (archived or missing)`);
  }
  const held = changeHold(result.change_id, deps);
  if (held) return none(held);
  if (deps.perChange(result.change_id)) return perChangeStart(result, deps);
  const task = deps.nextTask(result.change_id);
  return task ? ownerTaskRoute(result, task) : archiveRoute(result.change_id, deps);
}

/**
 * A per-change change continues on its open PR; without one, its next task
 * opens it, and the prompt must say so (per_change). With no task left on
 * main (the owner merged its PR before the archive), an archive PR follows.
 */
function perChangeStart(result, deps) {
  const open = deps.openFactoryPr(result.change_id);
  if (open) return babysitRoute(open, deps);
  const task = deps.nextTask(result.change_id);
  if (!task) return archiveRoute(result.change_id, deps);
  return { ...ownerTaskRoute(result, task), per_change: true };
}

const HOUR = 60 * 60 * 1000;

/**
 * The hourly schedule retries one failed run (task 5.4): the first open
 * tracking issue whose `factory-retry` label is over an hour old and that does
 * not also wait on the owner. Its label becomes `factory-retrying`, and the
 * retry runs in this workflow run: a babysit pass when the change has an open
 * factory PR, else a task.
 */
function retryRoute(deps) {
  const due = deps
    .retryCandidates()
    .map((issue) => ({ ...issue, id: changeFromLabels(issue.labels || []) }))
    .find(
      (issue) =>
        issue.id &&
        !(issue.labels || []).some((l) => (l.name || l) === 'needs-human') &&
        deps.now() - Date.parse(issue.labelledAt) > HOUR,
    );
  if (!due) return none('no retry due');
  const result = retryTarget(due, deps);
  return settleRetry(due.number, result, deps);
}

/** What the retry would run, decided before any label changes. */
function retryTarget(due, deps) {
  // This issue's own factory-retry label must not hold the retry it asks for.
  const unheld = { ...deps, retryIssue: () => 0 };
  const pr = deps.openFactoryPr(due.id);
  if (pr) return babysitRoute(pr, unheld);
  const task = { mode: 'task', change_id: due.id, reason: `retry from #${due.number}` };
  return activeOnly(task, unheld);
}

/**
 * Labels follow the route: a run swaps factory-retry for factory-retrying; a
 * wait (checks running, owner hold) keeps factory-retry for the next hour; any
 * other outcome (nothing actionable, an owner task, an archived change) needs
 * no retry, so the label goes and no stale factory-retrying is left behind.
 */
function settleRetry(number, result, deps) {
  if (CLAUDE_MODES.has(result.mode)) {
    deps.startRetry(number);
    // Marks this run as the retry: only it clears factory-retrying when it
    // succeeds, so a parallel success cannot reset the one-retry budget.
    return { ...result, retry: number };
  }
  if (isRetryWait(result)) return none(`retry from #${number} waits: ${result.reason}`);
  deps.dropRetry(number);
  if (result.mode === 'escalate') return result;
  return none(`retry from #${number} not needed: ${result.reason}`);
}

/** The modes that start a Claude run. */
const CLAUDE_MODES = new Set(['task', 'babysit', 'archive']);

const isRetryWait = (result) =>
  result.mode === 'none' &&
  (result.reason === 'Actions checks still running' || result.reason.startsWith('waiting on '));

/** An `(owner)` next task is escalated by the route job, never given to Claude. */
function ownerTaskRoute(result, task) {
  if (!task || !task.owner) return result;
  return {
    mode: 'escalate',
    change_id: result.change_id,
    task: task.number,
    reason: `task ${task.number} is an owner task`,
  };
}

function route(eventName, event, deps) {
  const relayedPr = eventName === 'workflow_dispatch' && event.inputs?.pr;
  if (relayedPr) return babysitRoute(prNumberOf(event), deps);
  if (eventName === 'workflow_dispatch') return activeOnly(dispatchRoute(event), deps);
  if (eventName === 'pull_request') return activeOnly(mergedRoute(event, deps), deps);
  if (eventName === 'issues') return activeOnly(issuesRoute(event, deps), deps);
  if (eventName === 'schedule') return retryRoute(deps);
  return babysitRoute(prNumberOf(event), deps);
}

/** $GITHUB_OUTPUT lines; values are ids, numbers and branch names only. */
function toOutput(result) {
  const keys = ['mode', 'change_id', 'pr', 'ref', 'task', 'retry', 'per_change', 'reason'];
  return keys.map((k) => `${k}=${String(result[k] ?? '').replace(/[\r\n]/g, ' ')}`).join('\n');
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });

/** Number of the change's open tracking issue that carries `label`, or 0. */
function issueWith(id, label) {
  const args = ['issue', 'list', '--state', 'open', '--label', `factory:${id}`];
  const list = JSON.parse(gh([...args, '--label', label, '--json', 'number']));
  return list.length ? list[0].number : 0;
}

/** When `factory-retry` was last added to issue `n` (ISO time), or ''. */
function retryLabelledAt(n) {
  const events = JSON.parse(
    gh(['api', '--paginate', '--slurp', `repos/{owner}/{repo}/issues/${n}/events`]),
  ).flat();
  const added = events.filter((e) => e.event === 'labeled' && e.label?.name === 'factory-retry');
  return added.length ? added.at(-1).created_at : '';
}

const defaultDeps = {
  changeExists: (id) => fs.existsSync(`openspec/changes/${id}/tasks.md`),
  nextTask: (id) => nextTask(fs.readFileSync(`openspec/changes/${id}/tasks.md`, 'utf8')),
  parkedIssue: (id) => issueWith(id, 'needs-human'),
  retryIssue: (id) => issueWith(id, 'factory-retry'),
  retryCandidates: () =>
    JSON.parse(
      gh([
        'issue',
        'list',
        '--state',
        'open',
        '--label',
        'factory-retry',
        '--json',
        'number,labels',
      ]),
    ).map((issue) => ({ ...issue, labelledAt: retryLabelledAt(issue.number) })),
  startRetry: (n) =>
    gh([
      'issue',
      'edit',
      String(n),
      '--remove-label',
      'factory-retry',
      '--add-label',
      'factory-retrying',
    ]),
  dropRetry: (n) => gh(['issue', 'edit', String(n), '--remove-label', 'factory-retry']),
  openFactoryPr: (id) => {
    const args = [
      'pr',
      'list',
      '--state',
      'open',
      '--label',
      `factory:${id}`,
      '--json',
      'number,author',
    ];
    const pr = JSON.parse(gh(args)).find((p) => isAppAuthor(authorOf(p)));
    return pr ? pr.number : 0;
  },
  now: () => Date.now(),
  prView: (n) =>
    JSON.parse(
      gh(['pr', 'view', String(n), '--json', 'state,labels,author,headRefName,title,isDraft']),
    ),
  feedback: (n) =>
    JSON.parse(execFileSync('node', ['scripts/pr-feedback.js', String(n)], { encoding: 'utf8' })),
  // Required lazily: factory-issue.js requires this file.
  perChange: (id) => {
    const file = `openspec/changes/${id}/proposal.md`;
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    return require('./factory-issue.js').perChangeFromProposal(text);
  },
  branchTask: (id, ref) => nextTask(branchFile(`openspec/changes/${id}/tasks.md`, ref)),
  branchArchived: (id, ref) => {
    const url = `repos/{owner}/{repo}/contents/openspec/changes/archive?ref=${encodeURIComponent(ref)}`;
    const names = missingAsEmpty(() => gh(['api', url, '--jq', '.[].name']));
    return names.split('\n').some((name) => isArchiveOf(name.trim(), id));
  },
  markReady: (pr, n) => {
    if (pr.isDraft) gh(['pr', 'ready', String(n)]);
    const title = pr.title.replace(/^WIP:\s*/i, '');
    if (title !== pr.title) gh(['pr', 'edit', String(n), '--title', title]);
    gh(['pr', 'comment', String(n), '--body', readyComment()]);
  },
};

/**
 * A file on a branch, through the contents API: the route job checks out only
 * main, so `git show origin/<branch>:<path>` has nothing to read.
 */
function branchFile(file, ref) {
  const url = `repos/{owner}/{repo}/contents/${file}?ref=${encodeURIComponent(ref)}`;
  return gh(['api', '-H', 'Accept: application/vnd.github.raw', url]);
}

/**
 * `read()`, or '' when the file is not there (a 404 from the contents API):
 * an archived change has no openspec/changes/<id>/ on its branch. Any other
 * error is thrown.
 */
function missingAsEmpty(read) {
  try {
    return read();
  } catch (error) {
    if (/HTTP 404|Not Found/.test(String(error.stderr || error.message))) return '';
    throw error;
  }
}

const OWNER = '@jatwell93';

function readyComment() {
  return [
    `${OWNER} Every task of this change is done and its reviews have settled, so this PR is ready for your review.`,
    'If GitHub says the branch is out of date, use "Update branch" before merging.',
  ].join('\n');
}

function main(env = process.env, deps = defaultDeps, log = console.log) {
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  log(toOutput(route(env.GITHUB_EVENT_NAME, event, deps)));
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = {
  OWNER,
  babysitRoute,
  branchFile,
  changeFromLabels,
  defaultDeps,
  factoryIdProblem,
  isArchiveOf,
  missingAsEmpty,
  nextTask,
  route,
  toOutput,
  main,
};
