const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  loadWorkflow,
  findStepIndex,
  verifyProductionBindingOrder,
  verifyRoleCheckIsolation,
} = require('./verify-workers-deploy-bindings.js');

test('preview migration validation uses a separate least-privilege Doppler token', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '..', '.github', 'workflows', 'workers-deploy.yml'),
    'utf8',
  );
  const previewJob = workflow.match(
    / {2}migration-prep-preview:\r?\n([\s\S]*?)(?=\r?\n {2}migration-prep-production:)/,
  );
  assert.ok(previewJob, 'migration-prep-preview job must exist');
  assert.match(previewJob[1], /DOPPLER_TOKEN:\s*\$\{\{\s*secrets\.MIGRATION_DOPPLER_TOKEN\s*\}\}/);
  assert.doesNotMatch(
    previewJob[1],
    /DOPPLER_TOKEN:\s*\$\{\{\s*secrets\.DOPPLER_TOKEN\s*\}\}/,
    'preview migration validation must not receive the broader deployment token',
  );
});

test('canary smoke rounds preserve the probe exit code while printing evidence', () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, '..', '.github', 'workflows', 'workers-deploy.yml'),
    'utf8',
  );

  for (const round of [1, 2]) {
    const step = workflow.match(
      new RegExp(
        `- name: Canary round ${round}[^\\r\\n]*\\r?\\n([\\s\\S]*?)(?=\\r?\\n\\s+- name:)`,
      ),
    );
    assert.ok(step, `canary round ${round} step must exist`);
    assert.match(step[1], /set \+e/);
    assert.match(step[1], new RegExp(`SMOKE_EXIT=\\$\\?`));
    assert.match(step[1], /set -e/);
    assert.match(step[1], new RegExp(`cat canary-round-${round}\\.json`));
    assert.match(step[1], new RegExp(`cat canary-round-${round}\\.stderr >&2`));
    assert.match(step[1], /exit "\$SMOKE_EXIT"/);
  }
});

test('real workflow: NEON_CONNECTION_STRING binding step precedes wrangler deploy', () => {
  const workflow = loadWorkflow();
  const errors = verifyProductionBindingOrder(workflow);
  if (errors.length > 0) {
    const messages = errors.map((e) => e.message).join('\n  - ');
    assert.fail(`workers-deploy.yml production binding order check failed:\n  - ${messages}`);
  }
  assert.ok(errors.length === 0);
});

test('real workflow: deploy-production job exists with steps', () => {
  const workflow = loadWorkflow();
  const job = workflow.jobs && workflow.jobs['deploy-production'];
  assert.ok(job, "job 'deploy-production' must exist");
  assert.ok(Array.isArray(job.steps) && job.steps.length > 0, 'job must have steps');
});

test('real workflow: FRONTEND_URL binding step also precedes wrangler deploy', () => {
  // Guards against the same class of bug regressing on FRONTEND_URL too.
  const workflow = loadWorkflow();
  const job = workflow.jobs['deploy-production'];
  const steps = job.steps;
  const feIdx = findStepIndex(steps, 'Bind FRONTEND_URL secret to worker');
  const deployIdx = findStepIndex(steps, 'Deploy production worker');
  assert.notEqual(feIdx, -1, 'FRONTEND_URL binding step must exist');
  assert.notEqual(deployIdx, -1, 'deploy step must exist');
  assert.ok(feIdx < deployIdx, 'FRONTEND_URL binding must precede deploy');
});

test('synthetic: missing binding step is reported', () => {
  const workflow = {
    jobs: {
      'deploy-production': {
        steps: [
          { name: 'Setup Node.js', run: 'node --version' },
          { name: 'Deploy production worker', run: 'npx wrangler deploy --env production' },
        ],
      },
    },
  };
  const errors = verifyProductionBindingOrder(workflow);
  const messages = errors.map((e) => e.message);
  assert.equal(errors.length, 1);
  assert.match(messages[0], /Missing step 'Bind NEON_CONNECTION_STRING secret to worker'/);
});

test('synthetic: binding step after deploy is reported as ordering violation', () => {
  const workflow = {
    jobs: {
      'deploy-production': {
        steps: [
          { name: 'Setup Node.js', run: 'node --version' },
          { name: 'Deploy production worker', run: 'npx wrangler deploy --env production' },
          {
            name: 'Bind NEON_CONNECTION_STRING secret to worker',
            run: 'printf \'%s\' "$X" | npx wrangler secret put NEON_CONNECTION_STRING --env production',
          },
        ],
      },
    },
  };
  const errors = verifyProductionBindingOrder(workflow);
  const messages = errors.map((e) => e.message);
  assert.equal(errors.length, 1);
  assert.match(messages[0], /must run BEFORE 'Deploy production worker'/);
});

test('synthetic: binding step with wrong wrangler subcommand is reported', () => {
  const workflow = {
    jobs: {
      'deploy-production': {
        steps: [
          {
            name: 'Bind NEON_CONNECTION_STRING secret to worker',
            run: 'npx wrangler deploy --env production',
          },
          { name: 'Deploy production worker', run: 'npx wrangler deploy --env production' },
        ],
      },
    },
  };
  const errors = verifyProductionBindingOrder(workflow);
  const messages = errors.map((e) => e.message);
  assert.ok(
    messages.some((m) => /wrangler secret put NEON_CONNECTION_STRING/.test(m)),
    `expected a missing-secret-put error, got: ${JSON.stringify(messages)}`,
  );
});

test('synthetic: deploy step without wrangler deploy is reported', () => {
  const workflow = {
    jobs: {
      'deploy-production': {
        steps: [
          {
            name: 'Bind NEON_CONNECTION_STRING secret to worker',
            run: 'printf \'%s\' "$X" | npx wrangler secret put NEON_CONNECTION_STRING --env production',
          },
          { name: 'Deploy production worker', run: 'echo not a deploy' },
        ],
      },
    },
  };
  const errors = verifyProductionBindingOrder(workflow);
  const messages = errors.map((e) => e.message);
  assert.ok(
    messages.some((m) =>
      /'Deploy production worker' step does not invoke `wrangler deploy`/.test(m),
    ),
    `expected a missing-deploy error, got: ${JSON.stringify(messages)}`,
  );
});

test('synthetic: missing deploy-production job is reported', () => {
  const workflow = { jobs: { 'some-other-job': { steps: [] } } };
  const errors = verifyProductionBindingOrder(workflow);
  const messages = errors.map((e) => e.message);
  assert.equal(errors.length, 1);
  assert.match(messages[0], /Missing job 'deploy-production'/);
});

test('synthetic: job with no steps is reported', () => {
  const workflow = { jobs: { 'deploy-production': { steps: [] } } };
  const errors = verifyProductionBindingOrder(workflow);
  const messages = errors.map((e) => e.message);
  assert.equal(errors.length, 1);
  assert.match(messages[0], /has no steps/);
});

test('synthetic: well-formed workflow returns no errors', () => {
  const workflow = {
    jobs: {
      'deploy-production': {
        steps: [
          {
            name: 'Bind FRONTEND_URL secret to worker',
            run: 'printf \'%s\' "$X" | npx wrangler secret put FRONTEND_URL --env production',
          },
          {
            name: 'Bind NEON_CONNECTION_STRING secret to worker',
            run: 'printf \'%s\' "$X" | npx wrangler secret put NEON_CONNECTION_STRING --env production',
          },
          { name: 'Deploy production worker', run: 'npx wrangler deploy --env production' },
        ],
      },
    },
  };
  const errors = verifyProductionBindingOrder(workflow);
  assert.deepEqual(errors, []);
});

test('findStepIndex is case-insensitive on the name substring', () => {
  const steps = [{ name: 'Bind NEON_CONNECTION_STRING SECRET to Worker' }];
  assert.equal(findStepIndex(steps, 'neon_connection_string secret'), 0);
  assert.equal(findStepIndex(steps, 'NONEXISTENT'), -1);
});

test('findStepIndex handles steps with no name field', () => {
  const steps = [
    { run: 'echo hi' },
    { name: 'Bind NEON_CONNECTION_STRING secret to worker', run: 'x' },
  ];
  assert.equal(findStepIndex(steps, 'NEON_CONNECTION_STRING'), 1);
  assert.equal(findStepIndex(steps, 'something missing'), -1);
});

test('real configuration: role_check environment is isolated and runbook uses it', () => {
  assert.deepEqual(verifyRoleCheckIsolation(), []);
});

test('synthetic: missing role_check environment is rejected', () => {
  const errors = verifyRoleCheckIsolation(
    '[env.production]\nname = "prod"\n',
    'wrangler deploy --env role_check\nwrangler secret put X --env role_check\nwrangler delete --env role_check\n',
  );
  assert.ok(errors.some((error) => /Missing dedicated/.test(error.message)));
});

test('synthetic: shared queue or route bindings in role_check are rejected', () => {
  const wrangler = `
[env.role_check]
name = "date-management-api-role-check"
workers_dev = true
[[env.role_check.queues.consumers]]
queue = "shared"
[[env.role_check.routes]]
pattern = "api.example.com/*"
`;
  const runbook =
    'wrangler deploy --env role_check\n' +
    'wrangler secret put NEON_CONNECTION_STRING --env role_check\n' +
    'wrangler delete --env role_check\n';
  const messages = verifyRoleCheckIsolation(wrangler, runbook).map((error) => error.message);
  assert.ok(messages.some((message) => /queues bindings/.test(message)));
  assert.ok(messages.some((message) => /routes bindings/.test(message)));
});

test('synthetic: nonexistent preview environment in runbook is rejected', () => {
  const wrangler = `
[env.role_check]
name = "date-management-api-role-check"
workers_dev = true
`;
  const errors = verifyRoleCheckIsolation(
    wrangler,
    'wrangler deploy --env preview\nwrangler secret put X --env preview\nwrangler delete --env preview\n',
  );
  assert.ok(errors.some((error) => /nonexistent Wrangler environment/.test(error.message)));
});
