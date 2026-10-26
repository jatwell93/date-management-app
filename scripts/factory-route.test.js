const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const {
  changeFromLabels,
  factoryIdProblem,
  nextTask,
  route,
  toOutput,
} = require('./factory-route.js');

const LABEL = { name: 'factory:add-x' };
const APP = { login: 'claude[bot]' };

function deps({
  pr = {},
  report = {},
  parked = 0,
  retry = 0,
  tasks = '- [ ] 1.1 Do it\n',
  candidates = [],
  openPr = 0,
} = {}) {
  const calls = { feedback: 0, startRetry: [], dropRetry: [] };
  return {
    calls,
    changeExists: (id) => id !== 'gone',
    parkedIssue: () => parked,
    retryIssue: () => retry,
    retryCandidates: () => candidates,
    startRetry: (n) => calls.startRetry.push(n),
    dropRetry: (n) => calls.dropRetry.push(n),
    openFactoryPr: () => openPr,
    now: () => Date.parse('2026-10-26T12:00:00Z'),
    nextTask: () => nextTask(tasks),
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
    'mode=none\nchange_id=\npr=\nref=\ntask=\nretry=\nreason=a b',
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

test('nextTask reads the first unchecked task and its (owner) marker', () => {
  const md = '- [x] 1.1 Done\n  - [ ] note\n- [ ] 1.2 (owner) Rotate the key\n- [ ] 1.3 Next\n';
  assert.deepEqual(nextTask(md), { number: '1.2', text: 'Rotate the key', owner: true });
  assert.deepEqual(nextTask('- [ ] 5.3a Check drafts\n'), {
    number: '5.3a',
    text: 'Check drafts',
    owner: false,
  });
  assert.equal(nextTask('- [ ] 5.1 `(owner)` marker\n').owner, false, 'a quoted marker is prose');
  assert.equal(nextTask('- [x] 1.1 Done\n'), null);
  assert.equal(nextTask('- [ ] ../x (owner) bad number\n'), null);
});

const OWNER_NEXT = '- [x] 2.1 Add the API\n- [ ] 2.2 (owner) Rotate the vendor key\n';

test('an (owner) next task escalates from the router on dispatch, merge and resume', () => {
  const owner = deps({ tasks: OWNER_NEXT });
  const merged = {
    action: 'closed',
    pull_request: { number: 7, merged: true, labels: [LABEL], user: APP },
  };
  for (const [name, event] of [
    ['workflow_dispatch', { inputs: { change_id: 'add-x' } }],
    ['pull_request', merged],
    ['issues', unlabeled()],
  ]) {
    assert.deepEqual(route(name, event, owner), {
      mode: 'escalate',
      change_id: 'add-x',
      task: '2.2',
      reason: 'task 2.2 is an owner task',
    });
  }
});

test('once the owner ticks the owner task, a resume starts the next task', () => {
  const ticked = deps({
    tasks: OWNER_NEXT.replace('- [ ] 2.2', '- [x] 2.2') + '- [ ] 2.3 Use it\n',
  });
  assert.equal(route('issues', unlabeled(), ticked).mode, 'task');
});

test('a held change waits before its owner task is escalated again', () => {
  const held = deps({ tasks: OWNER_NEXT, parked: 703 });
  assert.equal(route('workflow_dispatch', { inputs: { change_id: 'add-x' } }, held).mode, 'none');
});

const RETRY_ISSUE = (labelledAt, extra = []) => ({
  number: 714,
  labels: [LABEL, { name: 'factory-retry' }, ...extra],
  labelledAt,
});

test('the hourly schedule retries a failed task once its label is over an hour old', () => {
  const d = deps({ candidates: [RETRY_ISSUE('2026-10-26T10:30:00Z')] });
  assert.deepEqual(route('schedule', {}, d), {
    mode: 'task',
    change_id: 'add-x',
    reason: 'retry from #714',
    retry: 714,
  });
  assert.deepEqual(d.calls.startRetry, [714], 'factory-retry swapped for factory-retrying');
  assert.equal(
    route('workflow_dispatch', { inputs: { change_id: 'add-x' } }, deps()).retry,
    undefined,
  );
});

test('a fresh retry label, or one beside needs-human, starts nothing', () => {
  for (const issue of [
    RETRY_ISSUE('2026-10-26T11:40:00Z'),
    RETRY_ISSUE('2026-10-26T10:00:00Z', [{ name: 'needs-human' }]),
  ]) {
    const d = deps({ candidates: [issue] });
    assert.equal(route('schedule', {}, d).reason, 'no retry due');
    assert.deepEqual(d.calls.startRetry, []);
  }
  assert.equal(route('schedule', {}, deps()).mode, 'none', 'no candidates');
});

test('labels change only after the retry route is decided', () => {
  const due = [RETRY_ISSUE('2026-10-26T10:30:00Z')];
  // The issue's own factory-retry label does not hold its retry.
  const held = deps({ candidates: due, retry: 714 });
  assert.equal(route('schedule', {}, held).mode, 'task');
  assert.deepEqual(held.calls.startRetry, [714]);

  // Checks still running: keep factory-retry, try again next hour.
  const pending = deps({
    candidates: due,
    openPr: 9,
    report: { checks: { pendingActions: ['Workers Tests'] } },
  });
  assert.match(route('schedule', {}, pending).reason, /retry from #714 waits/);
  assert.deepEqual([pending.calls.startRetry, pending.calls.dropRetry], [[], []]);

  // Nothing to retry: drop the label, never leave factory-retrying behind.
  const idle = deps({ candidates: due, openPr: 9, report: { unresolvedThreads: [] } });
  assert.match(route('schedule', {}, idle).reason, /not needed: nothing actionable/);
  assert.deepEqual([idle.calls.startRetry, idle.calls.dropRetry], [[], [714]]);

  // The next task is the owner's: drop the label and escalate.
  const owner = deps({ candidates: due, tasks: OWNER_NEXT });
  assert.equal(route('schedule', {}, owner).mode, 'escalate');
  assert.deepEqual([owner.calls.startRetry, owner.calls.dropRetry], [[], [714]]);
});

test('a retry on a change with an open factory PR is a babysit pass', () => {
  const d = deps({ candidates: [RETRY_ISSUE('2026-10-26T10:30:00Z')], openPr: 9 });
  const r = route('schedule', {}, d);
  assert.equal(r.mode, 'babysit');
  assert.equal(r.pr, 9);
});

test('no Claude run starts on any route while the tracking issue has factory-retry', () => {
  const waiting = deps({ retry: 714 });
  const merged = {
    action: 'closed',
    pull_request: { number: 7, merged: true, labels: [LABEL], user: APP },
  };
  for (const [name, event] of [
    ['workflow_dispatch', { inputs: { change_id: 'add-x' } }],
    ['pull_request', merged],
    ['pull_request_review', { pull_request: { number: 9 } }],
    ['pull_request_review_comment', { pull_request: { number: 9 } }],
    ['workflow_dispatch', { inputs: { pr: '9' } }],
  ]) {
    const r = route(name, event, waiting);
    assert.equal(r.mode, 'none', name);
    assert.match(r.reason, /waiting to retry: #714 has factory-retry/);
  }
  assert.equal(waiting.calls.feedback, 0, 'no feedback fetch while waiting');
});

test('a babysit route waits while the tracking issue has needs-human', () => {
  const r = route('pull_request_review', { pull_request: { number: 9 } }, deps({ parked: 703 }));
  assert.match(r.reason, /waiting on the owner: #703/);
});
