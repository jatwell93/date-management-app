const test = require('node:test');
const assert = require('node:assert/strict');

const { sweep } = require('./factory-sweep.js');
const { nextTask } = require('./factory-route.js');
const { BASELINE } = require('./check-no-go.js');

const LABEL = { name: 'factory:add-x' };
const SETTLED = { settled: true, waitingOn: [], unresolvedThreads: [], reviews: [] };

/** Fake deps for one open per-change PR #9; records dispatches and ready marks. */
function deps({
  pr = {},
  report = {},
  parked = 0,
  retry = 0,
  retrying = 0,
  perChange = true,
  tasks = '- [x] 1.1 Do it\n- [ ] 1.2 Next\n',
} = {}) {
  const calls = { dispatch: [], markReady: [] };
  const view = {
    state: 'OPEN',
    labels: [LABEL],
    author: { login: 'app/claude' },
    headRefName: 'feature/factory-add-x',
    title: 'WIP: feat(x): add x',
    ...pr,
  };
  return {
    calls,
    openAppPrs: () => [{ number: 9, labels: view.labels }],
    perChange: () => perChange,
    parkedIssue: () => parked,
    retryIssue: () => retry,
    retryingIssue: () => retrying,
    prView: () => view,
    feedback: () => ({
      ...SETTLED,
      headCommittedAt: '2026-10-27T01:00:00Z',
      ...report,
      checks: { pendingActions: [], fail: [], ...report.checks },
    }),
    branchTask: () => nextTask(tasks),
    markReady: (p, n) => calls.markReady.push(n),
    dispatch: (n) => calls.dispatch.push(n),
  };
}

const quiet = () => {};

test('a settled per-change PR with a task left is dispatched', () => {
  const d = deps();
  assert.equal(sweep(d, quiet), 1);
  assert.deepEqual(d.calls.dispatch, [9]);
});

test('an actionable per-change PR is dispatched for a babysit pass', () => {
  const thread = { author: 'sentry', replies: [] };
  const d = deps({ report: { unresolvedThreads: [thread] } });
  sweep(d, quiet);
  assert.deepEqual(d.calls.dispatch, [9]);
});

test('a waiting PR is not dispatched', () => {
  for (const report of [
    { settled: false, waitingOn: ['quiet window'] },
    { checks: { pendingActions: ['Workers Test'] } },
  ]) {
    const d = deps({ report });
    assert.equal(sweep(d, quiet), 0);
    assert.deepEqual(d.calls.dispatch, []);
  }
});

test('a parked PR, or one whose change waits on a retry, is not dispatched', () => {
  for (const opts of [
    { parked: 703 },
    { pr: { labels: [LABEL, { name: 'needs-human' }] } },
    { retry: 714 },
    { retrying: 714 },
  ]) {
    const d = deps(opts);
    assert.equal(sweep(d, quiet), 0, JSON.stringify(opts));
  }
});

test('a PR with no task left is marked ready by the sweep itself, not dispatched', () => {
  const d = deps({ tasks: '- [x] 1.1 Do it\n' });
  assert.equal(sweep(d, quiet), 0);
  assert.deepEqual(d.calls.markReady, [9]);
});

test('a per-task factory PR is left to its events', () => {
  const d = deps({ perChange: false });
  assert.equal(sweep(d, quiet), 0);
});

test('the sweep script is on the no_go baseline', () => {
  assert.ok(BASELINE.includes('scripts/factory-sweep.js'));
});
