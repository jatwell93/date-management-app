const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const { changeFromLabels, factoryIdProblem, route, toOutput } = require('./factory-route.js');

const LABEL = { name: 'factory:add-x' };
const APP = { login: 'claude[bot]' };

function deps({ pr = {}, report = {}, parked = 0 } = {}) {
  const calls = { feedback: 0 };
  return {
    calls,
    changeExists: (id) => id !== 'gone',
    parkedIssue: () => parked,
    prView: () => ({
      state: 'OPEN',
      labels: [LABEL],
      author: { login: 'app/claude' },
      headRefName: 'feature/factory-add-x-1.1',
      ...pr,
    }),
    feedback: () => {
      calls.feedback += 1;
      return {
        headCommittedAt: '2026-10-23T01:00:00Z',
        unresolvedThreads: [{ author: 'sentry', replies: [] }],
        reviews: [],
        ...report,
        checks: { pendingActions: [], fail: [], ...report.checks },
      };
    },
  };
}

test('changeFromLabels takes factory:<id>, skipping factory:run and unsafe ids', () => {
  assert.equal(changeFromLabels([{ name: 'factory:run' }, LABEL]), 'add-x');
  assert.equal(changeFromLabels(['factory:../etc']), '');
  assert.equal(changeFromLabels([{ name: 'bug' }]), '');
});

test('workflow_dispatch starts a task on a valid change id only', () => {
  assert.deepEqual(route('workflow_dispatch', { inputs: { change_id: 'add-x' } }, deps()), {
    mode: 'task',
    change_id: 'add-x',
    reason: 'dispatched',
  });
  assert.equal(route('workflow_dispatch', { inputs: { change_id: 'A b' } }, deps()).mode, 'none');
});

test('a change id longer than 42 characters cannot be dispatched (factory:<id> label limit)', () => {
  const at = (n) => route('workflow_dispatch', { inputs: { change_id: 'a'.repeat(n) } }, deps());
  assert.equal(at(42).mode, 'task');
  assert.equal(at(43).mode, 'none');
  assert.match(at(43).reason, /43 characters; factory:<id> labels allow 42/);
});

// Changes written before the factory that it will never run: operator-heavy
// migration work. A new change must fit, so the router can label its PRs.
const NOT_FOR_THE_FACTORY = new Set(['use-cloudflare-r2-and-a-serverless-database']);

test('every active change id fits the factory:<id> label limit', () => {
  const dir = path.join(__dirname, '..', 'openspec', 'changes');
  const ids = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive' && !NOT_FOR_THE_FACTORY.has(d.name))
    .map((d) => d.name);
  const tooLong = ids.filter((id) => /characters/.test(factoryIdProblem(id)));
  assert.deepEqual(tooLong, [], 'rename these change folders before the factory runs them');
});

test('a task on an archived or missing change routes to none', () => {
  const r = route('workflow_dispatch', { inputs: { change_id: 'gone' } }, deps());
  assert.equal(r.mode, 'none');
  assert.match(r.reason, /archived or missing/);
});

test('a merged factory PR starts the next task of its change', () => {
  const event = {
    action: 'closed',
    pull_request: { number: 7, merged: true, labels: [LABEL], user: APP },
  };
  assert.deepEqual(route('pull_request', event, deps()), {
    mode: 'task',
    change_id: 'add-x',
    reason: '#7 merged',
  });
});

test('closed-unmerged, unlabelled or owner-authored PRs start nothing', () => {
  const base = { number: 7, merged: true, labels: [LABEL], user: APP };
  const cases = [
    { ...base, merged: false },
    { ...base, labels: [] },
    { ...base, user: { login: 'jatwell93' } },
  ];
  for (const pr of cases)
    assert.equal(
      route('pull_request', { action: 'closed', pull_request: pr }, deps()).mode,
      'none',
    );
});

test('a review on a factory PR with actionable items starts a babysit pass', () => {
  const d = deps();
  const r = route('pull_request_review', { pull_request: { number: 9 } }, d);
  assert.deepEqual(r, {
    mode: 'babysit',
    change_id: 'add-x',
    pr: 9,
    ref: 'feature/factory-add-x-1.1',
    reason: 'actionable',
  });
});

test('a dispatch relayed from a finished CI run babysits the PR it names', () => {
  const r = route('workflow_dispatch', { inputs: { pr: '11' } }, deps());
  assert.equal(r.mode, 'babysit');
  assert.equal(r.pr, 11);
  assert.equal(route('workflow_dispatch', { inputs: { pr: '11; x' } }, deps()).mode, 'none');
});

test('threads the factory already answered and reviews older than the head do not count', () => {
  const ev = { pull_request: { number: 9 } };
  const answered = deps({
    report: { unresolvedThreads: [{ author: 'jatwell93', replies: [{ author: 'claude' }] }] },
  });
  assert.equal(route('pull_request_review', ev, answered).reason, 'nothing actionable');
  const oldReview = deps({
    report: {
      unresolvedThreads: [],
      reviews: [{ actionable: true, submittedAt: '2026-10-23T00:30:00Z' }],
    },
  });
  assert.equal(route('pull_request_review', ev, oldReview).reason, 'nothing actionable');
  const freshReview = deps({
    report: {
      unresolvedThreads: [],
      reviews: [{ actionable: true, submittedAt: '2026-10-23T01:05:00Z' }],
    },
  });
  assert.equal(route('pull_request_review', ev, freshReview).mode, 'babysit');
  const failing = deps({ report: { unresolvedThreads: [], checks: { fail: ['Workers Tests'] } } });
  assert.equal(route('pull_request_review', ev, failing).mode, 'babysit');
});

test('babysit is skipped while Actions checks run, when nothing is actionable, or on needs-human', () => {
  const ev = { pull_request: { number: 9 } };
  assert.equal(
    route(
      'pull_request_review',
      ev,
      deps({ report: { checks: { pendingActions: ['Workers Tests'] } } }),
    ).reason,
    'Actions checks still running',
  );
  assert.equal(
    route('pull_request_review', ev, deps({ report: { unresolvedThreads: [] } })).reason,
    'nothing actionable',
  );
  const human = deps({ pr: { labels: [LABEL, { name: 'needs-human' }] } });
  assert.equal(route('pull_request_review', ev, human).reason, 'waiting on the owner');
  assert.equal(human.calls.feedback, 0, 'no feedback fetch once parked');
});

test('a label alone never routes the factory onto an owner PR', () => {
  const owner = deps({ pr: { author: { login: 'jatwell93' } } });
  assert.equal(route('pull_request_review', { pull_request: { number: 9 } }, owner).mode, 'none');
  const closed = deps({ pr: { state: 'MERGED' } });
  assert.equal(route('pull_request_review', { pull_request: { number: 9 } }, closed).mode, 'none');
});

test('toOutput prints one key=value line each, without newlines in values', () => {
  assert.equal(
    toOutput({ mode: 'none', reason: 'a\nb' }),
    'mode=none\nchange_id=\npr=\nref=\nreason=a b',
  );
});

const OWNER = { login: 'jatwell93' };
const unlabeled = ({ label = 'needs-human', sender = OWNER, labels = [LABEL] } = {}) => ({
  action: 'unlabeled',
  label: { name: label },
  sender,
  repository: { owner: OWNER },
  issue: { number: 703, labels },
});

test('every task route waits while the tracking issue has needs-human', () => {
  const parked = deps({ parked: 703 });
  const merged = {
    action: 'closed',
    pull_request: { number: 7, merged: true, labels: [LABEL], user: APP },
  };
  for (const [name, event] of [
    ['workflow_dispatch', { inputs: { change_id: 'add-x' } }],
    ['pull_request', merged],
  ]) {
    const r = route(name, event, parked);
    assert.equal(r.mode, 'none', name);
    assert.match(r.reason, /waiting on the owner: #703/);
  }
});

test('the owner removing needs-human from a tracking issue resumes the change', () => {
  assert.deepEqual(route('issues', unlabeled(), deps()), {
    mode: 'task',
    change_id: 'add-x',
    reason: '#703 resumed by the owner',
  });
});

test('only the owner can resume, and only by removing needs-human', () => {
  const byBot = route('issues', unlabeled({ sender: { login: 'claude[bot]' } }), deps());
  assert.equal(byBot.mode, 'none');
  assert.match(byBot.reason, /someone other than the owner/);
  assert.equal(route('issues', unlabeled({ label: 'bug' }), deps()).mode, 'none');
  assert.equal(route('issues', unlabeled({ labels: [{ name: 'bug' }] }), deps()).mode, 'none');
});

test('a resume still waits if another needs-human issue holds the change', () => {
  assert.equal(route('issues', unlabeled(), deps({ parked: 704 })).mode, 'none');
});
