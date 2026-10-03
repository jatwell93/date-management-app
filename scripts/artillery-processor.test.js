const test = require('node:test');
const assert = require('node:assert/strict');

const { requireBearerToken, countAuthRejections } = require('../artillery-processor.js');

function withToken(value, fn) {
  const previous = process.env.LOAD_TEST_BEARER_TOKEN;
  if (value === undefined) delete process.env.LOAD_TEST_BEARER_TOKEN;
  else process.env.LOAD_TEST_BEARER_TOKEN = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.LOAD_TEST_BEARER_TOKEN;
    else process.env.LOAD_TEST_BEARER_TOKEN = previous;
  }
}

function callRequire() {
  let result;
  requireBearerToken({}, null, (error) => {
    result = error;
  });
  return result;
}

test('requireBearerToken fails the run when the token is unset or blank', () => {
  for (const value of [undefined, '', '   ']) {
    const error = withToken(value, callRequire);
    assert.ok(error instanceof Error, JSON.stringify(value));
    assert.match(error.message, /LOAD_TEST_BEARER_TOKEN is required/);
  }
});

test('requireBearerToken lets the run start when a token is set', () => {
  assert.equal(withToken('eyJ.example.token', callRequire), undefined);
});

test('countAuthRejections counts 401s and nothing else', () => {
  const emitted = [];
  const events = { emit: (...args) => emitted.push(args) };
  for (const statusCode of [200, 401, 403, 500, 401]) {
    let called = false;
    countAuthRejections({}, { statusCode }, {}, events, () => {
      called = true;
    });
    assert.ok(called, `done not called for ${statusCode}`);
  }

  assert.deepEqual(emitted, [
    ['counter', 'auth.rejected', 1],
    ['counter', 'auth.rejected', 1],
  ]);
});
