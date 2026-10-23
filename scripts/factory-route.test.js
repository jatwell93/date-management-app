const test = require('node:test');
const assert = require('node:assert/strict');

const { changeFromLabels, route, toOutput } = require('./factory-route.js');

const LABEL = { name: 'factory:add-x' };
const APP = { login: 'claude[bot]' };

function deps({ pr = {}, report = {} } = {}) {
  const calls = { feedback: 0 };
  return {
    calls,
    changeExists: (id) => id !== 'gone',
    prView: () => ({
      state: 'OPEN',
      labels: [LABEL],
      author: { login: 'app/claude' },
      headRefName: 'feature/factory-add-x-1.1',
      ...pr,
    }),
    feedback: () => {
      calls.feedback += 1;
      return { actionable: 2, checks: { pendingActions: [] }, ...report };
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

test('workflow_run reads the PR number from the run', () => {
  const r = route('workflow_run', { workflow_run: { pull_requests: [{ number: 11 }] } }, deps());
  assert.equal(r.pr, 11);
  assert.equal(route('workflow_run', { workflow_run: { pull_requests: [] } }, deps()).mode, 'none');
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
    route('pull_request_review', ev, deps({ report: { actionable: 0 } })).reason,
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
