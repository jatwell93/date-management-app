'use strict';

/**
 * Refuse to write secrets into memory.jsonl.
 *
 * memory.jsonl is committed and this repository is public, so anything appended
 * is permanent and world-readable. mem-log.js calls `findSensitive` before the
 * append and aborts on a hit; recall-on-start.sh runs the same check over text
 * it is about to inject. Matches are reported by pattern name only, never by
 * value, so the refusal message does not itself leak the secret into a terminal
 * log or transcript.
 *
 * Coverage limit: mem-backfill.js rewrites memory.jsonl from the local index
 * without this check. The index is fed by mem-log.js, so it is guarded
 * inductively, but keep the index free of secrets too.
 *
 * This is a tripwire for accidents, not a substitute for judgement: the written
 * rule in AGENTS.md §7 (no secrets, customer data, prod hostnames or unfixed
 * vulnerability detail) still applies to prose these patterns cannot see.
 * Assignment matching is deliberately limited to UPPER_SNAKE names, so prose
 * such as "password: rotate-quarterly-schedule" is not refused.
 */

const PATTERNS = [
  { name: 'Stripe or Clerk secret key', regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/ },
  { name: 'OpenAI or Anthropic secret key', regex: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: 'Slack token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'webhook signing secret', regex: /\bwhsec_[A-Za-z0-9+/=]{8,}/ },
  {
    name: 'database URL with credentials',
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/i,
  },
  { name: 'AWS access key id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: 'JSON web token',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/,
  },
  {
    name: 'GitHub token',
    regex: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/,
  },
  { name: 'private key block', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'bearer token', regex: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/ },
  {
    // Keyword anywhere in an UPPER_SNAKE name: PASSWORD=, SECRET_KEY=,
    // JWT_SECRET_KEY=, STRIPE_API_KEY=, DB_PASSWORD_PROD=.
    name: 'secret assignment',
    regex:
      /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*[:=]\s*["']?[A-Za-z0-9+/_-]{16,}/,
  },
  {
    name: 'Neon database hostname',
    regex: /\bep-[a-z0-9-]+(?:-pooler)?\.[a-z0-9-]+\.aws\.neon\.tech\b/i,
  },
];

/** Names of the patterns that match any of the given strings. */
function findSensitive(...texts) {
  const haystack = texts.filter((text) => typeof text === 'string').join('\n');
  return PATTERNS.filter(({ regex }) => regex.test(haystack)).map(({ name }) => name);
}

module.exports = { findSensitive, PATTERNS };

// `node scripts/mem-redact.js` reads stdin and exits 1 when it matches, so shell
// hooks can reuse the same patterns without duplicating them.
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    process.exit(findSensitive(input).length > 0 ? 1 : 0);
  });
}
