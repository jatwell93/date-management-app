#!/usr/bin/env node
/**
 * Ask the owner to do an `(owner)` task (OpenSpec change
 * factory-one-merge-per-change, task 5.1). Run by the `escalate` job of
 * .github/workflows/factory.yml when the router finds that the next unchecked
 * task of a change is marked `- [ ] 2.3 (owner) ...`, so no Claude run is spent
 * finding out that the task is not the factory's.
 *
 * It adds `needs-human` to the change's tracking issue (scripts/factory-issue.js)
 * and comments the task. The router holds the change until the owner removes the
 * label; if the task is still unticked then, the router escalates again.
 *
 * Usage: node scripts/factory-escalate.js <change-id> <task-number>
 * Exit codes: 0 escalated, or nothing to do (the task is no longer next);
 * 2 usage error.
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const { factoryIdProblem, nextTask } = require('./factory-route.js');
const { trackingIssue } = require('./factory-issue.js');

const OWNER = '@jatwell93';
const TASK_NUMBER = /^[0-9][0-9A-Za-z.]{0,19}$/;

/** Why the arguments are unusable, or ''. */
function usageProblem(id, number) {
  return factoryIdProblem(id) || (TASK_NUMBER.test(number) ? '' : 'invalid task number');
}

/** Markdown body of the escalation comment. */
function comment(id, task) {
  return [
    `${OWNER} Task ${task.number} of \`${id}\` is an owner task, so the factory will not attempt it:`,
    '',
    `> ${task.text}`,
    '',
    `Do it, tick it in \`openspec/changes/${id}/tasks.md\` on \`main\`, then remove \`needs-human\` to resume.`,
    'If the task is still unticked when the label goes, the factory asks again.',
  ].join('\n');
}

const defaultDeps = {
  gh: (args) => execFileSync('gh', args, { encoding: 'utf8' }),
  proposal: (id) => {
    const file = `openspec/changes/${id}/proposal.md`;
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  },
  tasks: (id) => fs.readFileSync(`openspec/changes/${id}/tasks.md`, 'utf8'),
};

/** The next task, if it is still owner task `number`; the list can change after routing. */
function stillNextOwnerTask(tasksMd, number) {
  const task = nextTask(tasksMd);
  return task && task.owner && task.number === number ? task : null;
}

function main(argv = process.argv.slice(2), deps = defaultDeps, log = console.log) {
  const [id = '', number = ''] = argv;
  const problem = usageProblem(id, number);
  if (problem) {
    console.error(`usage: factory-escalate.js <change-id> <task-number>: ${problem}`);
    return 2;
  }
  const task = stillNextOwnerTask(deps.tasks(id), number);
  if (!task) {
    log(`Task ${number} of ${id} is no longer the next owner task; nothing to do.`);
    return 0;
  }
  return escalate(id, task, deps, log);
}

function escalate(id, task, deps, log) {
  const issue = String(trackingIssue(id, deps));
  // Label first: the hold matters more than the comment.
  deps.gh(['issue', 'edit', issue, '--add-label', 'needs-human']);
  deps.gh(['issue', 'comment', issue, '--body', comment(id, task)]);
  log(`Escalated task ${task.number} of ${id} on #${issue}.`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { OWNER, comment, main };
