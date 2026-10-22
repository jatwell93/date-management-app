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

test('factory.yml uses no secret but the Claude OAuth token', () => {
  assert.deepEqual(secretsUsed(FACTORY), ['CLAUDE_CODE_OAUTH_TOKEN']);
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

test('factory.yml queues one run per change and never cancels a running one', () => {
  assert.deepEqual(topLevelBlock(FACTORY, 'concurrency'), [
    'group: factory-${{ inputs.change_id }}',
    'cancel-in-progress: false',
  ]);
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

test('factory.yml validates the change id before using it', () => {
  const validate = FACTORY.indexOf('Validate change id');
  const action = FACTORY.indexOf('anthropics/claude-code-action@');
  assert.ok(validate !== -1 && validate < action);
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
