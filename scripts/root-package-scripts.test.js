const assert = require('node:assert/strict');
const test = require('node:test');

const packageJson = require('../package.json');

test('root lifecycle scripts use cross-platform npm commands', () => {
  for (const scriptName of ['prepare', 'pretest', 'posttest']) {
    const command = packageJson.scripts?.[scriptName];
    assert.equal(typeof command, 'string', `${scriptName} must be declared`);
    assert.doesNotMatch(command, /\bnpm\.cmd\b/i, `${scriptName} must not require npm.cmd`);
  }
});
