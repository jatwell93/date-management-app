const test = require('node:test');
const assert = require('node:assert/strict');

const { main } = require('./factory-retry.js');
const { BASELINE } = require('./check-no-go.js');

const RUN = 'https://github.com/jatwell93/date-management-app/actions/runs/111';
const RETRY_RUN = 'https://github.com/jatwell93/date-management-app/actions/runs/222';

/** A fake `gh` with one open tracking issue (#714); records every call. */
function fakeGh({ labels = [], comments = [], retrying = [] } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify(args.includes('factory-retrying') ? retrying : [{ number: 714 }]);
    }
    if (args[0] === 'issue' && args[1] === 'view') {
      return JSON.stringify({ labels: labels.map((name) => ({ name })), comments });
    }
    return '';
  };
  return { gh, calls };
}

const deps = (gh) => ({ gh, proposal: () => '' });
const edits = (calls) => calls.filter((c) => c[0] === 'issue' && c[1] === 'edit');
const bodies = (calls) => calls.filter((c) => c[1] === 'comment').map((c) => c[4]);

test('a first failure labels the tracking issue factory-retry and comments the run with a marker', () => {
  const { gh, calls } = fakeGh();
  assert.equal(
    main(['fail', 'add-x', RUN], deps(gh), () => {}),
    0,
  );
  assert.deepEqual(edits(calls), [['issue', 'edit', '714', '--add-label', 'factory-retry']]);
  const [body] = bodies(calls);
  assert.match(body, /failed: https:\/\/github\.com\/.*\/runs\/111/);
  assert.match(body, /<!-- factory-retry run: https:\/\/github\.com\/\S+\/runs\/111 -->/);
  assert.ok(
    calls.some((c) => c[0] === 'label' && c.includes('factory-retry')),
    'label exists first',
  );
});

test('a failed retry escalates with both run links and drops factory-retrying', () => {
  const { gh, calls } = fakeGh({
    labels: ['factory:add-x', 'factory-retrying'],
    comments: [{ body: `failed\n\n<!-- factory-retry run: ${RUN} -->` }],
  });
  assert.equal(
    main(['fail', 'add-x', RETRY_RUN], deps(gh), () => {}),
    0,
  );
  assert.deepEqual(edits(calls), [
    ['issue', 'edit', '714', '--remove-label', 'factory-retrying', '--add-label', 'needs-human'],
  ]);
  const [body] = bodies(calls);
  assert.match(body, /^@jatwell93 /);
  assert.ok(body.includes(`first: ${RUN}`) && body.includes(`retry: ${RETRY_RUN}`));
  assert.doesNotMatch(body, /<!-- factory-retry run/, 'no marker: this is not a retry');
});

test('a success removes factory-retrying, and does nothing when it is absent', () => {
  const withLabel = fakeGh({ retrying: [{ number: 714 }] });
  assert.equal(
    main(['ok', 'add-x'], deps(withLabel.gh), () => {}),
    0,
  );
  assert.deepEqual(edits(withLabel.calls), [
    ['issue', 'edit', '714', '--remove-label', 'factory-retrying'],
  ]);
  const without = fakeGh();
  main(['ok', 'add-x'], deps(without.gh), () => {});
  assert.deepEqual(edits(without.calls), []);
  assert.ok(!without.calls.some((c) => c[1] === 'create'), 'a success never creates an issue');
});

test('rejects a bad command, change id or run url before calling gh', () => {
  for (const argv of [
    ['retry', 'add-x', RUN],
    ['fail', '../x', RUN],
    ['fail', 'add-x', 'https://example.com/runs/1'],
    ['fail', 'add-x', `${RUN}; rm`],
  ]) {
    const { gh, calls } = fakeGh();
    assert.equal(
      main(argv, deps(gh), () => {}),
      2,
      argv.join(' '),
    );
    assert.equal(calls.length, 0);
  }
});

test('the retry script is on the no_go baseline', () => {
  assert.ok(BASELINE.includes('scripts/factory-retry.js'));
});
