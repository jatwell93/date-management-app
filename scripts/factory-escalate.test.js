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

test("on a per-change PR, reads the branch's task list and asks for the tick there", () => {
  const { gh, calls } = fakeGh();
  const refs = [];
  const d = { ...deps(gh), tasks: (id, ref) => (refs.push(ref), TASKS) };
  assert.equal(
    main(['add-x', '2.2', 'feature/factory-add-x'], d, () => {}),
    0,
  );
  assert.deepEqual(refs, ['feature/factory-add-x']);
  const body = calls.find((c) => c[1] === 'comment')[4];
  assert.match(body, /tasks\.md` on `feature\/factory-add-x`, then remove/);
  assert.equal(
    main(['add-x', '2.2', 'x;rm -rf'], d, () => {}),
    2,
    'unsafe branch rejected',
  );
});

test('does nothing when the task is no longer the next owner task', () => {
  for (const tasks of [
    TASKS.replace('- [ ] 2.2', '- [x] 2.2'), // ticked meanwhile
    TASKS.replace('(owner) ', ''), // no longer an owner task
    '', // archived meanwhile: tasks.md is gone (factory-tickets-and-autostart 5.1)
  ]) {
    const { gh, calls } = fakeGh();
    assert.equal(
      main(['add-x', '2.2'], deps(gh, tasks), () => {}),
      0,
    );
    assert.equal(calls.length, 0, 'no label, issue or comment');
  }
});

test("main's tasks.md missing (the change archived on main) asks for nothing", () => {
  // The real file reader, on a change with no folder: no throw, no gh call.
  const lines = [];
  assert.equal(
    main(['no-such-change-archived', '2.2'], undefined, (l) => lines.push(l)),
    0,
  );
  assert.match(lines[0], /no longer the next owner task/);
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
