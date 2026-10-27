const test = require('node:test');
const assert = require('node:assert/strict');

const {
  issueFromProposal,
  perChangeFromProposal,
  trackingIssue,
  main,
} = require('./factory-issue.js');

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

const proposal = (autonomy) =>
  `## Why\n\nIssue #12 is related; see also issue #40.\n\n## Autonomy\n\n\`\`\`yaml\nmerge: human\n${autonomy}no_go:\n  - backend/**\n\`\`\`\n\n## Impact\n\nissue: 99\n`;
const PROPOSAL = proposal('issue: 671 # the bug report\n');

test("issueFromProposal reads only the Autonomy block's issue key", () => {
  assert.equal(issueFromProposal(PROPOSAL), 671);
  assert.equal(issueFromProposal(proposal('issue: #671\n')), 671);
  assert.equal(
    issueFromProposal(proposal('')),
    0,
    'issues cited in prose or other sections never count',
  );
  assert.equal(issueFromProposal('Issue #671. No Autonomy block.'), 0);
});

test('perChangeFromProposal reads only the Autonomy block\'s "pr: per-change"', () => {
  assert.equal(perChangeFromProposal(proposal('pr: per-change # one merge\n')), true);
  assert.equal(perChangeFromProposal(proposal('pr: per-task\n')), false);
  assert.equal(perChangeFromProposal(proposal('')), false);
  assert.equal(perChangeFromProposal('## Impact\n\npr: per-change\n'), false, 'outside the block');
});

test('an open issue labelled factory:<id> wins, untouched', () => {
  const { gh, calls } = fakeGh({ labelled: [{ number: 703 }] });
  assert.equal(trackingIssue('add-x', deps(gh, PROPOSAL)), 703);
  assert.equal(calls.length, 1);
});

test("the proposal's open issue is adopted: labelled, never duplicated", () => {
  const { gh, calls } = fakeGh();
  assert.equal(trackingIssue('add-x', deps(gh, PROPOSAL)), 671);
  assert.ok(calls.includes('issue edit 671 --add-label factory:add-x'));
  assert.ok(!calls.some((c) => c.startsWith('issue create')));
});

test('a closed proposal issue is not reused; a new one is created', () => {
  const { gh, calls } = fakeGh({ state: 'CLOSED' });
  assert.equal(trackingIssue('add-x', deps(gh, PROPOSAL)), 90);
  assert.ok(!calls.some((c) => c.startsWith('issue edit')));
  assert.ok(
    calls.some((c) => c.startsWith('issue create --title factory: add-x --label factory:add-x')),
  );
});

test("main rejects an id whose factory:<id> label would pass GitHub's 50 characters", () => {
  const { gh, calls } = fakeGh();
  assert.equal(
    main(['a'.repeat(43)], deps(gh), () => {}),
    2,
  );
  assert.equal(calls.length, 0, 'no label, issue or comment is attempted');
});

test('main rejects an unsafe change id', () => {
  const { gh, calls } = fakeGh();
  assert.equal(
    main(['../x'], deps(gh), () => {}),
    2,
  );
  assert.equal(calls.length, 0);
});
