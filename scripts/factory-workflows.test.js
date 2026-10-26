// Static checks on the factory workflows (OpenSpec change add-spec-factory-runner,
// tasks 1.2 and 1.2a). They read the YAML as text: the properties that matter are
// short, fixed lines, and root declares no YAML parser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (name) =>
  fs
    .readFileSync(path.join(__dirname, '..', '.github', 'workflows', name), 'utf8')
    .replace(/\r\n/g, '\n');

const FACTORY = read('factory.yml');
const GUARD = read('no-go-guard.yml');

/** The `key: value` lines of a top-level YAML block, comments dropped. */
function topLevelBlock(yaml, key) {
  const lines = yaml.split('\n');
  const start = lines.indexOf(`${key}:`);
  assert.notEqual(start, -1, `${key}: block present`);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line) && line !== '') break;
    const kv = line.replace(/\s+#.*$/, '').trim();
    if (kv) body.push(kv);
  }
  return body;
}

const secretsUsed = (yaml) => [
  ...new Set([...yaml.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1])),
];

test('factory.yml uses no secret but the Claude OAuth token and the job token', () => {
  assert.deepEqual(secretsUsed(FACTORY).sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'GITHUB_TOKEN']);
  assert.doesNotMatch(FACTORY, /\bprd\b|PRODUCTION|NEON_API_KEY|DOPPLER_TOKEN|STRIPE_/);
});

test('factory.yml grants exactly the permissions it needs', () => {
  assert.deepEqual(topLevelBlock(FACTORY, 'permissions').sort(), [
    'actions: read',
    'checks: read',
    'contents: write',
    'id-token: write',
    'issues: write',
    'pull-requests: write',
    'statuses: read',
  ]);
  assert.doesNotMatch(FACTORY, /^[ \t]+permissions:/m, 'no job-level permissions widen the grant');
});

test('factory.yml queues tasks per change and passes per PR, never cancelling a running one', () => {
  assert.doesNotMatch(
    FACTORY,
    /^concurrency:/m,
    'no workflow-wide group: events have no change id',
  );
  const run = FACTORY.slice(FACTORY.indexOf('\n  run:\n'));
  assert.match(
    run,
    /group: \$\{\{ needs\.route\.outputs\.mode == 'task' && format\('factory-\{0\}', needs\.route\.outputs\.change_id\) \|\| format\('factory-babysit-\{0\}', needs\.route\.outputs\.pr\) \}\}/,
  );
  assert.match(run, /^ {6}cancel-in-progress: false$/m);
});

test('factory.yml starts on dispatch, merges and reviews; CI runs come through the relay', () => {
  const on = topLevelBlock(FACTORY, 'on');
  for (const trigger of [
    'workflow_dispatch:',
    'pull_request:',
    'pull_request_review:',
    'pull_request_review_comment:',
    'pr:',
    'issues:',
    'schedule:',
  ]) {
    assert.ok(on.includes(trigger), `${trigger} present`);
  }
  assert.ok(!on.includes('workflow_run:'), 'no workflow_run job checks out PR code here');
  assert.doesNotMatch(
    FACTORY,
    /^ {2}check_suite:/m,
    'check_suite never fires for Actions-created suites',
  );
  assert.match(FACTORY, /allowed_bots: 'sentry\[bot\],codescene-delta-analysis\[bot\]/);
});

test("factory.yml routes from main and runs main's rules on a PR branch", () => {
  const route = FACTORY.slice(FACTORY.indexOf('\n  route:\n'), FACTORY.indexOf('\n  run:\n'));
  assert.match(route, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(route, /node scripts\/factory-route\.js/);
  const run = FACTORY.slice(FACTORY.indexOf('\n  run:\n'));
  const restore = run.indexOf('git checkout origin/main -- "${rules[@]}"');
  assert.ok(restore !== -1 && restore < run.indexOf('anthropics/claude-code-action@'));
  for (const f of [
    'scripts/check-no-go.js',
    'scripts/babysit-round.js',
    'scripts/factory-route.js',
    'scripts/factory-issue.js',
    'scripts/factory-escalate.js',
    'scripts/factory-retry.js',
  ]) {
    assert.ok(run.includes(f), `${f} restored from main`);
  }
});

test('factory.yml checks for a due retry hourly and records every finished Claude run', () => {
  assert.match(FACTORY, /^ {2}schedule:\n {4}- cron: '23 \* \* \* \*'$/m);
  const report = FACTORY.slice(FACTORY.indexOf('\n  report:\n'));
  assert.ok(report.length > 1, 'report job present');
  assert.match(report, /^ {4}needs: \[route, run\]$/m);
  assert.match(
    report,
    /if: always\(\) && \(needs\.run\.result == 'failure' \|\| needs\.run\.result == 'success'\)/,
    'a cancelled run records nothing',
  );
  assert.match(report, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(report, /node scripts\/factory-retry\.js fail "\$CHANGE_ID" "\$RUN_URL"/);
  assert.match(
    report,
    /elif \[ -n "\$RETRY" \]; then\n(?: *#[^\n]*\n)* *node scripts\/factory-retry\.js ok "\$CHANGE_ID"/,
    'only the retry run clears factory-retrying',
  );
  assert.match(report, /RETRY: \$\{\{ needs\.route\.outputs\.retry \}\}/);
  assert.match(FACTORY, /retry: \$\{\{ steps\.route\.outputs\.retry \}\}/);
  assert.doesNotMatch(report, /claude-code-action|CLAUDE_CODE_OAUTH_TOKEN/);
});

test("the Claude step's timeout is below its job's, so a timeout fails the job", () => {
  const run = FACTORY.slice(FACTORY.indexOf('\n  run:\n'), FACTORY.indexOf('\n  escalate:\n'));
  const job = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(run)[1]);
  const claude = run.slice(run.indexOf('- name: Run Claude'));
  const step = Number(/^ {8}timeout-minutes: (\d+)$/m.exec(claude)[1]);
  assert.ok(step < job, `step ${step} < job ${job}`);
});

test('factory.yml escalates an owner task from main with the job token, no Claude run', () => {
  const escalate = FACTORY.slice(FACTORY.indexOf('\n  escalate:\n'));
  assert.ok(escalate.length > 1, 'escalate job present');
  assert.match(escalate, /^ {4}needs: route$/m);
  assert.match(escalate, /if: needs\.route\.outputs\.mode == 'escalate'/);
  assert.match(escalate, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(
    escalate,
    /group: \$\{\{ format\('factory-\{0\}', needs\.route\.outputs\.change_id\) \}\}/,
  );
  assert.match(escalate, /node scripts\/factory-escalate\.js "\$CHANGE_ID" "\$TASK"/);
  assert.doesNotMatch(escalate, /claude-code-action|CLAUDE_CODE_OAUTH_TOKEN/);
  assert.match(FACTORY, /task: \$\{\{ steps\.route\.outputs\.task \}\}/);
});

test('factory.yml denies merging, approving and raw API calls', () => {
  const deny = FACTORY.match(/--disallowedTools "([^"]+)"/);
  assert.ok(deny, '--disallowedTools present');
  for (const tool of ['Bash(gh pr merge:*)', 'Bash(gh pr review:*)', 'Bash(gh api:*)']) {
    assert.ok(deny[1].split(',').includes(tool), `${tool} denied`);
  }
  const allow = FACTORY.match(/--allowedTools "([^"]+)"/)[1].split(',');
  for (const tool of allow) {
    assert.doesNotMatch(tool, /^Bash\(gh (pr merge|pr review|api)\b/, `${tool} is not allowed`);
  }
});

test('factory.yml runs Claude only after the router (which validates the change id)', () => {
  assert.match(FACTORY, /^ {4}needs: route$/m);
  assert.match(
    FACTORY,
    /if: needs\.route\.outputs\.mode == 'task' \|\| needs\.route\.outputs\.mode == 'babysit'/,
  );
});

test('no-go-guard.yml runs from main and never checks out the PR head', () => {
  assert.match(GUARD, /^on:\n {2}pull_request_target:/m);
  assert.doesNotMatch(GUARD, /^[ \t]+ref:/m, 'checkout uses the default (base) ref');
  assert.doesNotMatch(GUARD, /head\.(ref|repo)/, 'no PR head branch or fork is fetched');
  assert.match(GUARD, /persist-credentials: false/);
  assert.deepEqual(topLevelBlock(GUARD, 'permissions').sort(), [
    'contents: read',
    'pull-requests: read',
    'statuses: write',
  ]);
});

test('no-go-guard.yml checks both sides of a rename and posts the head status', () => {
  assert.match(GUARD, /\.filename, \(\.previous_filename \/\/ empty\)/);
  assert.match(GUARD, /node scripts\/check-no-go\.js --change all --files/);
  assert.doesNotMatch(GUARD, /change_id|CHANGE_ID/, 'labels never choose which list applies');
  assert.match(GUARD, /statuses\/\$HEAD_SHA" -f state=failure/);
  assert.doesNotMatch(
    GUARD,
    /\$\{\{\s*github\.event\.pull_request\.(title|body)/,
    'no PR text in the workflow',
  );
});

const RELAY = read('factory-ci-relay.yml');

test('factory-ci-relay.yml only dispatches: no checkout, no PR code, minimal token', () => {
  assert.match(RELAY, /^on:\n {2}workflow_run:/m);
  assert.doesNotMatch(RELAY, /actions\/checkout|npm |node /, 'nothing from the PR runs here');
  assert.deepEqual(topLevelBlock(RELAY, 'permissions').sort(), [
    'actions: write',
    'pull-requests: read',
    'statuses: read',
  ]);
  assert.deepEqual(secretsUsed(RELAY), ['GITHUB_TOKEN']);
  assert.match(RELAY, /"\$author" != "app\/claude"/, 'only factory PRs are relayed');
  assert.match(RELAY, /gh workflow run factory\.yml --repo "\$REPO" -f pr="\$PR"/);
});

test('the relay re-runs the guard from main when a factory head has no guard status', () => {
  const step = RELAY.slice(RELAY.indexOf('Re-run the no-go guard'));
  assert.match(step, /\[ "\$author" = "app\/claude" \] \|\| exit 0/, 'factory PRs only');
  assert.match(step, /select\(\.context == "factory\/no-go-guard"\)/);
  assert.match(step, /gh workflow run no-go-guard\.yml --repo "\$REPO" --ref main -f pr="\$PR"/);
});

test('no-go-guard.yml accepts a dispatch only on main, and reads the PR from the API', () => {
  assert.match(GUARD, /^ {2}workflow_dispatch:\n {4}inputs:\n {6}pr:/m);
  assert.match(
    GUARD,
    /if: github\.event_name == 'pull_request_target' \|\| github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(GUARD, /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \|\| inputs\.pr \}\}/);
  assert.match(
    GUARD,
    /group: no-go-guard-\$\{\{ github\.event\.pull_request\.number \|\| inputs\.pr \}\}/,
  );
  const read = GUARD.slice(GUARD.indexOf("Read the PR's head"));
  assert.match(read, /\[\[ "\$PR_NUMBER" =~ \^\[1-9\]\[0-9\]\*\$ \]\]/, 'pr is validated');
  assert.match(read, /HEAD_SHA=\$\(jq -r \.head\.sha/);
  assert.match(GUARD, /moved past \$HEAD_SHA; not posting a status/, 'no status for a stale head');
});

test("the relay listens to exactly pr-feedback's CI_WORKFLOWS", () => {
  const { CI_WORKFLOWS } = require('./pr-feedback.js');
  const block = RELAY.slice(
    RELAY.indexOf('    workflows:\n'),
    RELAY.indexOf('    types: [completed]'),
  );
  const listed = [...block.matchAll(/^ {6}- '?([^'\n]+?)'?$/gm)].map((m) => m[1]);
  assert.deepEqual(listed.sort(), [...CI_WORKFLOWS].sort());
});

test('factory.yml resumes a change only from a needs-human removal', () => {
  assert.match(FACTORY, /^ {2}issues:\n {4}types: \[unlabeled\]$/m);
});

const DIGEST = read('factory-digest.yml');

test('factory-digest.yml runs main daily with the job token only, and no Claude run', () => {
  assert.match(DIGEST, /^on:\n {2}schedule:\n {4}# [^\n]*\n {4}- cron: '0 21 \* \* \*'$/m);
  assert.match(DIGEST, /^ {2}workflow_dispatch:$/m);
  assert.deepEqual(secretsUsed(DIGEST), ['GITHUB_TOKEN']);
  assert.doesNotMatch(DIGEST, /claude-code-action/);
  assert.match(DIGEST, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(DIGEST, /persist-credentials: false/);
  assert.deepEqual(topLevelBlock(DIGEST, 'permissions').sort(), [
    'actions: read',
    'checks: read',
    'contents: read',
    'issues: write',
    'pull-requests: read',
    'statuses: read',
  ]);
  assert.match(DIGEST, /run: node scripts\/factory-digest\.js$/m);
});

test('factory.yml fails the route step on a router crash and keeps restored rules out of commits', () => {
  const route = FACTORY.slice(FACTORY.indexOf('Decide what this event needs'));
  assert.match(route.slice(0, 400), /shell: bash/, 'bash adds pipefail to the tee pipeline');
  const restore = FACTORY.slice(FACTORY.indexOf("Use main's copy of the factory's own rules"));
  assert.match(restore, /git reset --quiet -- "\$\{rules\[@\]\}"/);
  assert.match(restore, /git update-index --skip-worktree/);
  assert.match(restore, /\.git\/info\/exclude/);
});
