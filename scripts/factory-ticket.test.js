const test = require('node:test');
const assert = require('node:assert/strict');

const { taskTicket, main } = require('./factory-ticket.js');

const TASKS = [
  '## 1. Work',
  '',
  '- [x] 1.1 Add the column (#812): migrate, then backfill.',
  '- [ ] 1.2 Show it, after #734 (#813) (#900)',
  '  - [ ] 1.3 a sub-item (#814)',
  '- [ ] 1.3 No ticket, see #735',
  '- [ ] 1.10 Tenth (#815)',
].join('\n');

test('taskTicket reads the first (#n) on the task line, ticked or not', () => {
  assert.equal(taskTicket(TASKS, '1.1'), 812);
  assert.equal(taskTicket(TASKS, '1.2'), 813, 'a bare #734 is a reference, not the ticket');
  assert.equal(taskTicket(TASKS, '1.10'), 815);
});

test('taskTicket returns 0 for a task without a ticket, a sub-item or a missing task', () => {
  assert.equal(taskTicket(TASKS, '1.3'), 0, 'the indented 1.3 is a sub-item');
  assert.equal(taskTicket(TASKS, '1'), 0);
  assert.equal(taskTicket(TASKS, '9.9'), 0);
  assert.equal(taskTicket('', '1.1'), 0);
});

test('main prints Closes #n, or nothing, and rejects bad arguments', () => {
  const lines = [];
  const out = (l) => lines.push(l);
  assert.equal(
    main(['add-x', '1.2'], () => TASKS, out),
    0,
  );
  assert.equal(
    main(['add-x', '1.3'], () => TASKS, out),
    0,
  );
  assert.deepEqual(lines, ['Closes #813']);
  const errors = [];
  const error = console.error;
  console.error = (l) => errors.push(l);
  try {
    assert.equal(
      main(['add-x', '../x'], () => TASKS, out),
      2,
    );
    assert.equal(
      main(['', '1.1'], () => TASKS, out),
      2,
    );
  } finally {
    console.error = error;
  }
  assert.equal(errors.length, 2);
  assert.deepEqual(lines, ['Closes #813']);
});
