const test = require('node:test');
const assert = require('node:assert/strict');

const { issueFromProposal, trackingIssue, main } = require('./factory-issue.js');

/** A fake `gh`: answers by subcommand and records every call. */
function fakeGh({
  labelled = [],
  state = 'OPEN',
  created = 'https://github.com/o/r/issues/90',
} = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(labelled);
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ state });
    if (args[0] === 'issue' && args[1] === 'create') return `${created}\n`;
    return '';
  };
  return { gh, calls };
}

const deps = (gh, proposal = '') => ({ gh, proposal: () => proposal });

test('issueFromProposal reads the first "Issue #N"', () => {
  assert.equal(issueFromProposal('## Why\n\nIssue #671. On the usage report...'), 671);
  assert.equal(issueFromProposal('See PR #12 and issue #40.'), 40);
  assert.equal(issueFromProposal('No issue here, only #5.'), 0);
});

test('an open issue labelled factory:<id> wins, untouched', () => {
  const { gh, calls } = fakeGh({ labelled: [{ number: 703 }] });
  assert.equal(trackingIssue('add-x', deps(gh, 'Issue #671.')), 703);
  assert.equal(calls.length, 1);
});

test("the proposal's open issue is adopted: labelled, never duplicated", () => {
  const { gh, calls } = fakeGh();
  assert.equal(trackingIssue('add-x', deps(gh, 'Issue #671.')), 671);
  assert.ok(calls.includes('issue edit 671 --add-label factory:add-x'));
  assert.ok(!calls.some((c) => c.startsWith('issue create')));
});

test('a closed proposal issue is not reused; a new one is created', () => {
  const { gh, calls } = fakeGh({ state: 'CLOSED' });
  assert.equal(trackingIssue('add-x', deps(gh, 'Issue #671.')), 90);
  assert.ok(!calls.some((c) => c.startsWith('issue edit')));
  assert.ok(
    calls.some((c) => c.startsWith('issue create --title factory: add-x --label factory:add-x')),
  );
});

test('main rejects an unsafe change id', () => {
  const { gh, calls } = fakeGh();
  assert.equal(
    main(['../x'], deps(gh), () => {}),
    2,
  );
  assert.equal(calls.length, 0);
});
