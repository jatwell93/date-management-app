const data = '0.191403,0.185367,0.150632,0.115040,0.162797,0.111680,0.135331,0.125438,0.146059,0.144388,0.132568,0.133501,0.117399,0.141109,0.133574,0.149480,0.124981,0.134946,0.142445,0.141571,0.119576,0.109870,0.132558,0.106506,0.114797,0.145836,0.100868,0.145935,0.133465,0.147193,0.111523,0.112379,0.125029,0.114197,0.112350,0.123369,0.138160,0.123809,0.153562,0.163585,0.101708,0.134175,0.139472,0.138085,0.129959,0.145029,0.108659,0.109891,0.110480,0.142241,0.109586,0.114464,0.106877,0.163412,0.139628,0.111259,0.121952,0.144114,0.125810,0.139879,0.106072,0.143111,0.112728,0.099688,0.114148,0.129483,0.137330,0.143634,0.156654,0.128548,0.138820,0.113071,0.131570,0.116259,0.118175,0.132811,0.150190,0.138911,0.143581,0.133914,0.125684,0.124200,0.127271,0.110870,0.121527,0.126510,0.138685,0.124962,0.123326,0.133331,0.138381,0.120366,0.146287,0.133499,0.125410,0.133568,0.132773,0.127179,0.134996,0.114743'
  .split(',')
  .map(v => parseFloat(v) * 1000)
  .filter(v => !Number.isNaN(v))
  .sort((a, b) => a - b);

const n = data.length;
const p = (q) => data[Math.floor(q * n)];
const mean = data.reduce((a, b) => a + b, 0) / n;

const stats = {
  samples: n,
  min_ms: data[0].toFixed(2),
  max_ms: data[n - 1].toFixed(2),
  mean_ms: mean.toFixed(2),
  median_ms: p(0.5).toFixed(2),
  p75_ms: p(0.75).toFixed(2),
  p90_ms: p(0.9).toFixed(2),
  p95_ms: p(0.95).toFixed(2),
  p99_ms: p(0.99).toFixed(2),
  target_p95: '200.00',
  passes_target: p(0.95) < 200
};

console.log('\nLoad Test Results (100 concurrent requests)\n');
console.log('='.repeat(50));
console.log(`Samples:     ${stats.samples}`);
console.log(`Min:         ${stats.min_ms} ms`);
console.log(`Max:         ${stats.max_ms} ms`);
console.log(`Mean:        ${stats.mean_ms} ms`);
console.log(`Median(p50): ${stats.median_ms} ms`);
console.log(`p75:         ${stats.p75_ms} ms`);
console.log(`p90:         ${stats.p90_ms} ms`);
console.log(`p95:         ${stats.p95_ms} ms ← TARGET <200ms`);
console.log(`p99:         ${stats.p99_ms} ms`);
console.log('='.repeat(50));
console.log(`\n${stats.passes_target ? '✅ PASS' : '❌ FAIL'}: p95 latency is ${stats.passes_target ? 'under' : 'over'} 200ms target\n`);

// JSON output for programmatic use
console.log('\nJSON Output:');
console.log(JSON.stringify(stats, null, 2));
