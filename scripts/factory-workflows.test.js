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

test('factory.yml grants exactly the five permissions it needs', () => {
  assert.deepEqual(topLevelBlock(FACTORY, 'permissions').sort(), [
    'actions: read',
    'contents: write',
    'id-token: write',
    'issues: write',
    'pull-requests: write',
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

test('factory.yml starts on dispatch, merges, reviews and finished CI runs', () => {
  const on = topLevelBlock(FACTORY, 'on');
  for (const trigger of [
    'workflow_dispatch:',
    'pull_request:',
    'pull_request_review:',
    'pull_request_review_comment:',
    'workflow_run:',
  ]) {
    assert.ok(on.includes(trigger), `${trigger} present`);
  }
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
  const restore = run.indexOf('git checkout origin/main -- .claude');
  assert.ok(restore !== -1 && restore < run.indexOf('anthropics/claude-code-action@'));
  for (const f of [
    'scripts/check-no-go.js',
    'scripts/babysit-round.js',
    'scripts/factory-route.js',
  ]) {
    assert.ok(run.includes(f), `${f} restored from main`);
  }
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
