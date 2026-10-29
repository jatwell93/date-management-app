const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', '.claude', 'hooks', 'main-guard.js');
const { verdict } = require(HOOK);

test('blocks git commit on main and allows it on a feature branch', () => {
  assert.match(verdict('git commit -m x', 'main'), /commit on main/);
  assert.equal(verdict('git commit -m x', 'feature/x'), '');
  assert.match(verdict('rtk git commit -qam x', 'main'), /commit on main/);
});

test('a switch earlier in the same command line counts', () => {
  assert.equal(verdict('git switch -c feature/x && git commit -m x', 'main'), '');
  assert.equal(verdict('git checkout -b feature/x; git commit -m x', 'main'), '');
  assert.match(verdict('git switch main && git commit -m x', 'feature/x'), /commit on main/);
});

test('blocks a push of main by implicit or HEAD refspec', () => {
  assert.match(verdict('git push', 'main'), /current branch, which is main/);
  assert.match(verdict('git push -q -u origin HEAD', 'main'), /current branch/);
  assert.equal(verdict('git push -q -u origin feature/x', 'main'), '');
  assert.equal(verdict('git push', 'feature/x'), '');
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
    assert.match(verdict(`git push origin ${spec}`, 'feature/x'), /pushes to main/, spec);
  }
  assert.equal(verdict('git push origin main-docs', 'feature/x'), '');
});

test('ignores heredoc bodies and other commands', () => {
  const heredoc = "git commit -F - <<'EOF'\nfix: x\n\ngit push origin main\nEOF";
  assert.equal(verdict(heredoc, 'feature/x'), '');
  assert.equal(verdict('gh pr create --base main', 'main'), '');
  assert.equal(verdict('git log --oneline -1', 'main'), '');
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
