#!/usr/bin/env node
/**
 * Print the `Closes #<n>` line for one task of an OpenSpec change, or nothing
 * when the task has no ticket (OpenSpec change factory-tickets-and-autostart,
 * task 3.2). run-spec puts the line in the PR body, so the owner's merge closes
 * the ticket that `to-tickets` published for the task.
 *
 * The ticket is the first `(#<n>):` on the task's own line, the form to-tickets
 * writes: `- [ ] 1.2 <title> (#812): ...`. A `#734` or `(#734)` cited in the
 * title or text is a reference, not the ticket: closing it would close an
 * unrelated issue. Sub-item lines are never read.
 *
 * Usage: node scripts/factory-ticket.js <change-id> <task-number>
 */
const fs = require('node:fs');

const { factoryIdProblem } = require('./factory-route.js');

const TASK_NUMBER = /^[0-9][0-9A-Za-z.]{0,19}$/;

/** The ticket number on task `number`'s line of a tasks.md, or 0. */
function taskTicket(tasksMd, number) {
  const line = (tasksMd || '')
    .split(/\r?\n/)
    .map((l) => /^- \[[ x]\] (\S+)\s+(.*)$/.exec(l))
    .find((m) => m && m[1] === number);
  const ticket = line && /\(#([1-9][0-9]*)\):/.exec(line[2]);
  return ticket ? Number(ticket[1]) : 0;
}

const defaultRead = (id) => {
  const path = `openspec/changes/${id}/tasks.md`;
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
};

/** Why the arguments are unusable, or ''. */
const argsProblem = (id, number) =>
  factoryIdProblem(id) || (TASK_NUMBER.test(number) ? '' : 'bad task number');

function main(argv = process.argv.slice(2), read = defaultRead, out = console.log) {
  const [id = '', number = ''] = argv;
  const problem = argsProblem(id, number);
  if (problem) {
    console.error(`usage: factory-ticket.js <change-id> <task-number>: ${problem}`);
    return 2;
  }
  const ticket = taskTicket(read(id), number);
  if (ticket) out(`Closes #${ticket}`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { taskTicket, main };
