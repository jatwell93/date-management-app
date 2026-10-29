const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', '.claude', 'hooks', 'main-guard.js');
const { verdict } = require(HOOK);

const ROOT = path.resolve('/repo');
const OTHER = path.resolve('/other');

/**
 * The verdict for `command` started in /repo on `branch`. /other is a checkout
 * on `otherBranch`. Names starting `feature/`, and `main`, are branches; any
 * other name (a file path) is not.
 */
function check(command, branch, otherBranch = 'feature/o') {
  return verdict(command, {
    cwd: ROOT,
    branchOf: (dir) => (dir === OTHER ? otherBranch : branch),
    isBranch: (name) => name === 'main' || name.startsWith('feature/'),
  });
}

test('blocks git commit on main and allows it on a feature branch', () => {
  assert.match(check('git commit -m x', 'main'), /commit on main/);
  assert.equal(check('git commit -m x', 'feature/x'), '');
  assert.match(check('rtk git commit -qam x', 'main'), /commit on main/);
});

test('sees git behind env assignments, wrappers, global flags and quotes', () => {
  assert.match(check('GIT_EDITOR=true git commit -m x', 'main'), /commit on main/);
  assert.match(check('command git commit -m x', 'main'), /commit on main/);
  assert.match(check('git --no-pager -c user.name=x commit -m x', 'main'), /commit on main/);
  assert.match(check('git push origin "HEAD:main"', 'feature/x'), /pushes to main/);
  assert.equal(check('echo git commit', 'main'), '');
});

test('a switch earlier in the same command line counts, a file checkout does not', () => {
  assert.equal(check('git switch -c feature/x && git commit -m x', 'main'), '');
  assert.equal(check('git checkout -b feature/x; git commit -m x', 'main'), '');
  assert.equal(check('git switch feature/y && git commit -m x', 'main'), '');
  assert.match(check('git switch main && git commit -m x', 'feature/x'), /commit on main/);
  assert.match(check('git checkout src/a.js && git commit -m x', 'main'), /commit on main/);
});

test('reads the branch where the command runs: cd and git -C', () => {
  assert.match(check(`cd ${OTHER} && git commit -m x`, 'feature/x', 'main'), /commit on main/);
  assert.equal(check(`cd ${OTHER} && git commit -m x`, 'main', 'feature/o'), '');
  assert.match(check(`git -C ${OTHER} commit -m x`, 'feature/x', 'main'), /commit on main/);
  assert.equal(check(`git -C ${OTHER} commit -m x`, 'main', 'feature/o'), '');
});

test('blocks a push of main by implicit or HEAD refspec', () => {
  assert.match(check('git push', 'main'), /current branch, which is main/);
  assert.match(check('git push -q -u origin HEAD', 'main'), /current branch/);
  assert.equal(check('git push -q -u origin feature/x', 'main'), '');
  assert.equal(check('git push', 'feature/x'), '');
});

test('blocks every refspec form that targets main', () => {
  for (const spec of [
    'main',
    'HEAD:main',
    ':main',
    'refs/heads/main',
    '+main',
    'x:refs/heads/main',
  ]) {
    assert.match(check(`git push origin ${spec}`, 'feature/x'), /pushes to main/, spec);
  }
  assert.equal(check('git push origin main-docs', 'feature/x'), '');
});

test('ignores heredoc bodies but not lines after a here-string', () => {
  const heredoc = "git commit -F - <<'EOF'\nfix: x\n\ngit push origin main\nEOF";
  assert.equal(check(heredoc, 'feature/x'), '');
  assert.match(check("cat <<<'EOF'\ngit push origin main", 'feature/x'), /pushes to main/);
  assert.equal(check('gh pr create --base main', 'main'), '');
  assert.equal(check('git log --oneline -1', 'main'), '');
});

test('the hook exits 2 with a reason on main and 0 elsewhere', () => {
  const run = (command, cwd) =>
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_input: { command }, cwd }),
      encoding: 'utf8',
    });
  const blocked = run('git push origin HEAD:main', process.cwd());
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /main-guard: blocked/);
  assert.equal(run('echo hi', process.cwd()).status, 0);
});
