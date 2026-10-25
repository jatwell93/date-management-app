const test = require('node:test');
const assert = require('node:assert/strict');

const { main } = require('./factory-escalate.js');
const { BASELINE } = require('./check-no-go.js');

const TASKS =
  '## 2\n\n- [x] 2.1 Add the API\n- [ ] 2.2 (owner) Rotate the vendor key\n- [ ] 2.3 Use it\n';

/** A fake `gh` with one open issue labelled factory:<id>; records every call. */
function fakeGh() {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify([{ number: 707 }]);
    return '';
  };
  return { gh, calls };
}

const deps = (gh, tasks = TASKS) => ({ gh, proposal: () => '', tasks: () => tasks });

test('labels the tracking issue needs-human, then comments the task for the owner', () => {
  const { gh, calls } = fakeGh();
  assert.equal(
    main(['add-x', '2.2'], deps(gh), () => {}),
    0,
  );
  const writes = calls.filter((c) => c[1] !== 'list');
  assert.deepEqual(writes[0], ['issue', 'edit', '707', '--add-label', 'needs-human']);
  assert.deepEqual(writes[1].slice(0, 4), ['issue', 'comment', '707', '--body']);
  const body = writes[1][4];
  assert.match(body, /^@jatwell93 Task 2\.2 of `add-x` is an owner task/);
  assert.match(body, /> Rotate the vendor key/);
  assert.match(body, /tick it in `openspec\/changes\/add-x\/tasks\.md` on `main`/);
});

test('does nothing when the task is no longer the next owner task', () => {
  for (const tasks of [
    TASKS.replace('- [ ] 2.2', '- [x] 2.2'), // ticked meanwhile
    TASKS.replace('(owner) ', ''), // no longer an owner task
  ]) {
    const { gh, calls } = fakeGh();
    assert.equal(
      main(['add-x', '2.2'], deps(gh, tasks), () => {}),
      0,
    );
    assert.equal(calls.length, 0, 'no label, issue or comment');
  }
});

test('rejects an unsafe change id or task number before calling gh', () => {
  for (const argv of [
    ['../x', '2.2'],
    ['add-x', '2.2; rm'],
    ['add-x', ''],
    ['a'.repeat(43), '1.1'],
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

test('the escalate script is on the no_go baseline', () => {
  assert.ok(BASELINE.includes('scripts/factory-escalate.js'));
});
