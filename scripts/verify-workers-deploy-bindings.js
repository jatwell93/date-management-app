/**
 * Static assertion over `.github/workflows/workers-deploy.yml` that the
 * production deploy job binds NEON_CONNECTION_STRING as a Worker secret
 * (via `wrangler secret put`) BEFORE running `wrangler deploy`.
 *
 * Why this exists: `wrangler deploy` does NOT upload surrounding-shell
 * env vars as Worker secret bindings — it only registers what is in
 * wrangler.toml `[env.*.vars]` plus secrets previously registered via
 * `wrangler secret put`. NEON_CONNECTION_STRING is a Worker secret
 * (wrangler.toml:168, workers/src/types/env.d.ts:35), not a
 * `[env.production.vars]` entry, so `doppler run -- npx wrangler deploy`
 * alone would leave the Worker bound to whatever NEON_CONNECTION_STRING
 * was last `secret put`'d — potentially a stale pre-cutover credential.
 * The production deploy job therefore has an explicit
 * `Bind NEON_CONNECTION_STRING secret to worker` step that re-binds the
 * value from Doppler on every deploy. This script asserts that step
 * exists and runs before `Deploy production worker`, so a future edit
 * that reorders or removes the binding step fails CI instead of
 * silently shipping a stale-credential Worker.
 *
 * Dependency-free: parses the workflow with a line-based scanner rather
 * than pulling in a YAML library (the repo has no direct `yaml`
 * dependency — it only resolves transitively, which is fragile to rely
 * on). The scanner tracks job blocks and the `- name:` / `run:` pairs
 * within them, which is all this assertion needs.
 *
 * Run via: node --test scripts/verify-workers-deploy-bindings.test.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'workers-deploy.yml');
const WRANGLER_PATH = path.join(REPO_ROOT, 'workers', 'wrangler.toml');
const RUNBOOK_PATH = path.join(REPO_ROOT, 'docs', 'migrations-deploy-runbook.md');

/**
 * Parse a GitHub Actions workflow YAML file into a minimal shape:
 * `{ jobs: { <job-name>: { steps: [ { name, run } ] } } }`.
 *
 * Only extracts job keys and the `name` + `run` fields of list items
 * inside a job's `steps:` sequence. Other YAML structure is ignored.
 * Multi-line `run: |` blocks are joined into a single string with
 * newlines so callers can regex across the full command.
 *
 * This is NOT a general YAML parser — it is a targeted scanner for the
 * fields this assertion needs. It assumes the workflow uses the
 * conventional 2-space indentation and `- name:` step entries that
 * GitHub Actions workflows follow.
 *
 * @param {string} text
 * @returns {{jobs: Record<string, {steps: Array<{name?: string, run?: string}>}>}}
 */
function parseWorkflow(text) {
  const lines = text.split(/\r?\n/);
  const workflow = { jobs: {} };
  let inJobsBlock = false;
  let currentJob = null;
  let inSteps = false;
  let stepsIndent = -1;
  let currentStep = null;
  let runBlockIndent = -1;
  let runBlockLines = null;

  const flushRunBlock = () => {
    if (runBlockLines !== null && currentStep !== null) {
      currentStep.run = runBlockLines.join('\n');
    }
    runBlockLines = null;
    runBlockIndent = -1;
  };
  const flushStep = () => {
    flushRunBlock();
    if (currentStep !== null && currentJob !== null) {
      currentJob.steps.push(currentStep);
    }
    currentStep = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // A line is a comment-only line if its first non-space char is #.
    const trimmedStart = raw.replace(/^\s+/, '');
    if (trimmedStart === '' || trimmedStart.startsWith('#')) {
      // Blank/comment lines are dropped from joined run strings — we
      // only regex across non-comment command text, so this is safe.
      continue;
    }

    const indent = raw.length - raw.replace(/^\s+/, '').length;

    // Top-level key (indent 0).
    if (indent === 0) {
      flushStep();
      inSteps = false;
      stepsIndent = -1;
      currentJob = null;
      const keyMatch = raw.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (keyMatch) {
        // Only treat indent-2 keys as jobs when we are inside the
        // top-level `jobs:` block. Other top-level blocks (`on:`,
        // `permissions:`, `concurrency:`) also have indent-2 children
        // that must NOT be parsed as jobs.
        inJobsBlock = keyMatch[1] === 'jobs';
      }
      continue;
    }

    // Job entry under `jobs:` — `  <job-name>:` at indent 2.
    if (inJobsBlock && indent === 2) {
      const jobMatch = raw.match(/^\s{2}([A-Za-z0-9_.-]+):\s*$/);
      if (jobMatch) {
        flushStep();
        currentJob = { steps: [] };
        workflow.jobs[jobMatch[1]] = currentJob;
        inSteps = false;
        stepsIndent = -1;
        continue;
      }
    }

    // Inside a job: look for `    steps:` at indent 4.
    if (currentJob !== null && indent === 4) {
      flushStep();
      if (/^\s{4}steps:\s*$/.test(raw)) {
        inSteps = true;
        stepsIndent = 6; // step items live at indent 6
        continue;
      }
      // Any other indent-4 key ends the steps block.
      inSteps = false;
      continue;
    }

    if (!inSteps) continue;

    // Inside `steps:`: a new step item starts with `      - ` at the
    // step-item indent (conventionally 6 spaces).
    if (indent === stepsIndent && /^\s+-\s/.test(raw)) {
      flushStep();
      currentStep = {};
      // The same line may carry `- name: Foo`.
      const rest = raw.replace(/^\s+-\s+/, '');
      const nameMatch = rest.match(/^name:\s*(.*)$/);
      if (nameMatch) {
        currentStep.name = stripYamlScalar(nameMatch[1]);
      }
      const runMatch = rest.match(/^run:\s*(.*)$/);
      if (runMatch) {
        const val = runMatch[1].trimEnd();
        if (val === '|' || val === '>') {
          // Multi-line block scalar — collect following indented lines.
          runBlockLines = [];
          runBlockIndent = -1;
        } else {
          currentStep.run = stripYamlScalar(val);
        }
      }
      continue;
    }

    // Continuation of a step item: `        name:`, `        run:`, etc.
    if (currentStep !== null && indent > stepsIndent) {
      // Multi-line run block content.
      if (runBlockLines !== null) {
        if (runBlockIndent === -1) {
          // First content line sets the block indent.
          runBlockIndent = indent;
        }
        if (indent >= runBlockIndent) {
          // Strip the block-indent prefix to preserve relative indent.
          runBlockLines.push(raw.slice(runBlockIndent));
          continue;
        }
        // Dedent below the block indent ends the block.
        flushRunBlock();
        // Fall through to handle this line as a new field.
      }

      const nameMatch = raw.match(/^\s+name:\s*(.*)$/);
      if (nameMatch) {
        currentStep.name = stripYamlScalar(nameMatch[1]);
        continue;
      }
      const runMatch = raw.match(/^\s+run:\s*(.*)$/);
      if (runMatch) {
        const val = runMatch[1].trimEnd();
        if (val === '|' || val === '>') {
          runBlockLines = [];
          runBlockIndent = -1;
        } else {
          currentStep.run = stripYamlScalar(val);
        }
        continue;
      }
    }
  }
  flushStep();
  return workflow;
}

/**
 * Strip a YAML scalar value: remove surrounding quotes and trailing
 * inline comments that are preceded by whitespace (best-effort, since
 * we only use this for `name` and single-line `run` values).
 */
function stripYamlScalar(value) {
  let v = value.trim();
  // Remove trailing inline comment only when not inside quotes.
  if (v.startsWith('"')) {
    const end = v.lastIndexOf('"');
    if (end > 0) return v.slice(1, end);
  }
  if (v.startsWith("'")) {
    const end = v.lastIndexOf("'");
    if (end > 0) return v.slice(1, end);
  }
  // Strip ` # comment` from an unquoted scalar.
  const hashIdx = v.search(/\s+#/);
  if (hashIdx !== -1) v = v.slice(0, hashIdx);
  return v.trim();
}

/**
 * Load and parse the deploy workflow.
 * @returns {{jobs: Record<string, {steps: Array<{name?: string, run?: string}>}>}}
 */
function loadWorkflow() {
  const text = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  return parseWorkflow(text);
}

/**
 * Find a step in a job by case-insensitive name match.
 * @param {Array<{name?: string}>} steps
 * @param {string} nameSubstring
 * @returns {number} index of the step, or -1 if not found
 */
function findStepIndex(steps, nameSubstring) {
  const needle = nameSubstring.toLowerCase();
  return steps.findIndex((s) => (s.name || '').toLowerCase().includes(needle));
}

/**
 * Verify the production deploy job binds NEON_CONNECTION_STRING before
 * `wrangler deploy`. Returns an array of assertion errors (empty if all
 * pass) so callers can render a useful summary.
 */
function verifyProductionBindingOrder(workflow = loadWorkflow()) {
  const errors = [];
  const job = workflow.jobs && workflow.jobs['deploy-production'];
  if (!job) {
    errors.push(new Error("Missing job 'deploy-production' in workers-deploy.yml"));
    return errors;
  }
  const steps = job.steps || [];
  if (steps.length === 0) {
    errors.push(new Error("Job 'deploy-production' has no steps"));
    return errors;
  }

  const bindIdx = findStepIndex(steps, 'Bind NEON_CONNECTION_STRING secret to worker');
  if (bindIdx === -1) {
    errors.push(
      new Error(
        "Missing step 'Bind NEON_CONNECTION_STRING secret to worker' in deploy-production. " +
          'wrangler deploy does not upload shell env as Worker secrets; an explicit ' +
          'wrangler secret put step is required before deploy.',
      ),
    );
  }

  const deployIdx = findStepIndex(steps, 'Deploy production worker');
  if (deployIdx === -1) {
    errors.push(new Error("Missing step 'Deploy production worker' in deploy-production"));
  }

  if (bindIdx !== -1 && deployIdx !== -1 && bindIdx >= deployIdx) {
    errors.push(
      new Error(
        `'Bind NEON_CONNECTION_STRING secret to worker' (step ${bindIdx + 1}) must run ` +
          `BEFORE 'Deploy production worker' (step ${deployIdx + 1}). ` +
          'A deploy without a fresh secret binding could ship a Worker bound to a stale credential.',
      ),
    );
  }

  // The binding step must actually invoke `wrangler secret put` for
  // NEON_CONNECTION_STRING — a renamed or no-op step would otherwise
  // satisfy the name check above.
  if (bindIdx !== -1) {
    const bindStep = steps[bindIdx];
    const run = bindStep.run || '';
    if (!/wrangler\s+secret\s+put\s+NEON_CONNECTION_STRING/.test(run)) {
      errors.push(
        new Error(
          `'Bind NEON_CONNECTION_STRING secret to worker' step does not invoke ` +
            '`wrangler secret put NEON_CONNECTION_STRING`. Found run: ' +
            JSON.stringify(run),
        ),
      );
    }
  }

  // The deploy step must actually invoke `wrangler deploy` (not just
  // some other wrangler subcommand).
  if (deployIdx !== -1) {
    const deployStep = steps[deployIdx];
    const run = deployStep.run || '';
    if (!/wrangler\s+deploy/.test(run)) {
      errors.push(
        new Error(
          `'Deploy production worker' step does not invoke \`wrangler deploy\`. ` +
            'Found run: ' +
            JSON.stringify(run),
        ),
      );
    }
  }

  return errors;
}

/**
 * Verify that the temporary runtime-role Worker has a dedicated, isolated
 * Wrangler environment and that the operator runbook targets it consistently.
 *
 * @param {string} [wranglerText]
 * @param {string} [runbookText]
 * @returns {Error[]}
 */
function verifyRoleCheckIsolation(
  wranglerText = fs.readFileSync(WRANGLER_PATH, 'utf8'),
  runbookText = fs.readFileSync(RUNBOOK_PATH, 'utf8'),
) {
  const errors = [];
  const envStart = wranglerText.search(/^\[env\.role_check\]\s*$/m);
  if (envStart === -1) {
    errors.push(
      new Error("Missing dedicated '[env.role_check]' configuration in workers/wrangler.toml"),
    );
  } else {
    const afterStart = wranglerText.slice(envStart);
    const nextEnv = afterStart.slice(1).search(/^\[+\s*env\.(?!role_check(?:\.|\]))/m);
    const roleCheckBlock = nextEnv === -1 ? afterStart : afterStart.slice(0, nextEnv + 1);

    if (!/^name\s*=\s*"date-management-api-role-check"\s*$/m.test(roleCheckBlock)) {
      errors.push(
        new Error(
          "env.role_check must use the isolated Worker name 'date-management-api-role-check'",
        ),
      );
    }
    if (!/^workers_dev\s*=\s*true\s*$/m.test(roleCheckBlock)) {
      errors.push(
        new Error('env.role_check must enable workers_dev for its temporary smoke-test URL'),
      );
    }
    const forbidden = [
      'routes',
      'queues',
      'hyperdrive',
      'r2_buckets',
      'kv_namespaces',
      'analytics_engine',
    ];
    for (const binding of forbidden) {
      if (new RegExp(`\\[+\\s*env\\.role_check\\.${binding}\\b`, 'i').test(roleCheckBlock)) {
        errors.push(new Error(`env.role_check must not declare ${binding} bindings`));
      }
    }
  }

  const normalizedRunbook = runbookText.replace(/\\\r?\n\s*/g, ' ');
  if (/--env\s+preview\b/.test(normalizedRunbook)) {
    errors.push(new Error("Runbook references nonexistent Wrangler environment '--env preview'"));
  }
  for (const command of ['wrangler deploy', 'wrangler secret put', 'wrangler delete']) {
    const pattern = new RegExp(`${command.replace(/\s+/g, '\\s+')}[^\\n]*--env\\s+role_check`, 'm');
    if (!pattern.test(normalizedRunbook)) {
      errors.push(new Error(`Runbook must invoke '${command}' with '--env role_check'`));
    }
  }
  return errors;
}

module.exports = {
  REPO_ROOT,
  WORKFLOW_PATH,
  WRANGLER_PATH,
  RUNBOOK_PATH,
  parseWorkflow,
  loadWorkflow,
  findStepIndex,
  verifyProductionBindingOrder,
  verifyRoleCheckIsolation,
};
