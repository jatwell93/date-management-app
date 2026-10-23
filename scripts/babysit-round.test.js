const test = require('node:test');
const assert = require('node:assert/strict');

const { highestRound, parseArgs, main } = require('./babysit-round.js');

function run(argv, trailers) {
  const out = { log: [], error: [], gitArgs: null };
  const code = main(argv, {
    git: (args) => {
      out.gitArgs = args;
      return trailers;
    },
    log: (s) => out.log.push(s),
    error: (s) => out.error.push(s),
  });
  return { code, ...out };
}

test('no trailers: round 0, the first round is allowed', () => {
  const r = run([], '\n\n');
  assert.equal(r.code, 0);
  assert.deepEqual(r.log, ['round=0 next=1 capped=false']);
  assert.deepEqual(r.gitArgs, [
    'log',
    'origin/main..HEAD',
    '--format=%(trailers:key=Babysit-Round,valueonly)',
  ]);
});

test('rounds 1 to 4: the highest counts and another round is allowed', () => {
  for (const n of [1, 2, 3, 4]) {
    const trailers = Array.from({ length: n }, (_, i) => String(i + 1)).join('\n\n');
    const r = run([], `${trailers}\n`);
    assert.equal(r.code, 0, `round ${n}`);
    assert.deepEqual(r.log, [`round=${n} next=${n + 1} capped=false`]);
  }
});

test('round 5: capped, exit 3', () => {
  const r = run([], '3\n\n5\n\n4\n');
  assert.equal(r.code, 3);
  assert.deepEqual(r.log, ['round=5 next=6 capped=true']);
});

test('highestRound ignores blank and non-numeric values', () => {
  assert.equal(highestRound('\n2\nabc\n 7 \n'), 7);
  assert.equal(highestRound(''), 0);
});

test('--base and --max are honoured; bad arguments exit 2', () => {
  assert.deepEqual(parseArgs(['--base', 'origin/dev', '--max', '3']), {
    base: 'origin/dev',
    max: 3,
  });
  const r = run(['--max', '2'], '2\n');
  assert.equal(r.code, 3);
  assert.equal(run(['--max', 'x'], '').code, 2);
  assert.equal(run(['--bogus'], '').code, 2);
});
