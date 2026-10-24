#!/usr/bin/env node
/**
 * Find the tracking issue of an OpenSpec change for the factory (OpenSpec
 * change add-spec-factory-runner, task 3.1), adopting or creating one, and
 * print its number. run-spec escalates and reports completion on it; the router
 * holds every new task of the change while it carries `needs-human`.
 *
 *   1. an open issue labelled `factory:<id>`
 *   2. else the open issue in the proposal's `## Autonomy` block (`issue: 671`),
 *      which gets the label, so a change written for an existing issue reports
 *      there
 *   3. else a new issue titled `factory: <id>`
 *
 * Usage: node scripts/factory-issue.js <change-id>
 */
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const { factoryIdProblem } = require('./factory-route.js');

/**
 * The `issue: N` key of the proposal's `## Autonomy` block, or 0. Only this
 * explicit key counts: a proposal cites other issues in passing, and adopting
 * one of those would post the factory's escalations on an unrelated issue.
 */
function issueFromProposal(text) {
  const autonomy = (text || '').split(/^## Autonomy[ \t]*$/m)[1] || '';
  const block = autonomy.split(/^## /m)[0];
  const m = /^issue:[ \t]*#?([1-9][0-9]*)[ \t]*(#.*)?$/m.exec(block);
  return m ? Number(m[1]) : 0;
}

function labelled(id, gh) {
  const list = JSON.parse(
    gh(['issue', 'list', '--state', 'open', '--label', `factory:${id}`, '--json', 'number']),
  );
  return list.length ? list[0].number : 0;
}

function ensureLabel(id, gh) {
  gh([
    'label',
    'create',
    `factory:${id}`,
    '--force',
    '--color',
    '5319E7',
    '--description',
    `Factory task for ${id}`,
  ]);
}

/** The proposal's issue, labelled for the change, if it is still open; else 0. */
function adopt(id, number, gh) {
  if (!number) return 0;
  const { state } = JSON.parse(gh(['issue', 'view', String(number), '--json', 'state']));
  if (state !== 'OPEN') return 0;
  ensureLabel(id, gh);
  gh(['issue', 'edit', String(number), '--add-label', `factory:${id}`]);
  return number;
}

function create(id, gh) {
  ensureLabel(id, gh);
  const url = gh([
    'issue',
    'create',
    '--title',
    `factory: ${id}`,
    '--label',
    `factory:${id}`,
    '--body',
    `Tracking issue for the factory run of \`${id}\`.`,
  ]);
  return Number(url.trim().split('/').pop());
}

function trackingIssue(id, deps) {
  return (
    labelled(id, deps.gh) ||
    adopt(id, issueFromProposal(deps.proposal(id)), deps.gh) ||
    create(id, deps.gh)
  );
}

const defaultDeps = {
  gh: (args) => execFileSync('gh', args, { encoding: 'utf8' }),
  proposal: (id) => {
    const path = `openspec/changes/${id}/proposal.md`;
    return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
  },
};

function main(argv = process.argv.slice(2), deps = defaultDeps, out = console.log) {
  const id = argv[0] || '';
  const problem = factoryIdProblem(id);
  if (problem) {
    console.error(`usage: factory-issue.js <change-id>: ${problem}`);
    return 2;
  }
  out(String(trackingIssue(id, deps)));
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { issueFromProposal, trackingIssue, main };
