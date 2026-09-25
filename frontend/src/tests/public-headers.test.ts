/**
 * Structural validation of `public/_headers` (task 3.1.o).
 *
 * A malformed `_headers` file fails silently: Cloudflare Pages drops the
 * offending lines, the build only copies the file, and nothing in CI reads it.
 * The failure mode is a quiet weakening of the deployed security posture, which
 * is exactly the kind of thing nobody notices until an audit. Two reviewers
 * raised this file's structure on PR #531 for that reason.
 *
 * **These assertions are deliberately structural, not a reimplementation of the
 * parser.** Rewriting Cloudflare's `parseHeaders` here would test my reading of
 * it rather than the file, and would drift from the real one. What is pinned
 * instead is the set of properties that make the file unambiguous under the
 * real parser, plus the two directives whose absence/presence is load-bearing
 * and was got wrong once already.
 *
 * Parser reference (bundled in wrangler as
 * `workers-shared/utils/configuration/parseHeaders.ts`): every line is
 * `.trim()`ed; blank and `#` lines `continue` without closing the current rule;
 * a new rule begins only on a line matching a path pattern; header lines are
 * split on the first `:`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RAW = readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8');
const LINES = RAW.split(/\r?\n/);

/** Lines the parser acts on: blanks and comments are skipped entirely. */
const SIGNIFICANT = LINES.map((line) => line.trim()).filter(
  (line) => line.length > 0 && !line.startsWith('#'),
);

const PATH_LINES = SIGNIFICANT.filter((line) => line.startsWith('/'));
const HEADER_LINES = SIGNIFICANT.filter((line) => !line.startsWith('/'));

describe('public/_headers', () => {
  it('declares exactly one rule', () => {
    // More than one `/*` block produces multiple rules with the same path, and
    // whether Pages applies all of them or only the first is a property of the
    // matcher that this repo has not verified. One rule keeps the question from
    // arising. An earlier revision had two.
    expect(PATH_LINES).toEqual(['/*']);
  });

  it('places the rule before every header line', () => {
    const firstPathIndex = SIGNIFICANT.findIndex((line) => line.startsWith('/'));

    expect(firstPathIndex).toBe(0);
  });

  it('gives every header line a name and a non-empty value', () => {
    for (const line of HEADER_LINES) {
      expect(line).toContain(':');
      const [name, ...rest] = line.split(':');
      expect(name.trim()).not.toBe('');
      expect(name.trim()).not.toContain(' ');
      expect(rest.join(':').trim()).not.toBe('');
    }
  });

  it('keeps every line within the 2000-character parser limit', () => {
    for (const line of LINES) {
      expect(line.length).toBeLessThanOrEqual(2000);
    }
  });

  it('does not restrict the camera', () => {
    // The regression that matters most here. `/scan` is the post-login landing
    // route and drives getUserMedia through Quagga; `camera=()` makes that
    // reject with NotAllowedError and shows no prompt. Permissions-Policy has
    // no Report-Only mode, so it would break the primary flow on deploy with no
    // warning. An earlier revision of this file shipped it.
    const permissionsPolicy = HEADER_LINES.find((line) =>
      line.toLowerCase().startsWith('permissions-policy:'),
    );

    expect(permissionsPolicy).toBeDefined();
    expect(permissionsPolicy).not.toContain('camera');
  });

  it('keeps the CSP Report-Only until its origins are verified', () => {
    // Flipping to enforcing is a deliberate step with a checklist in the file.
    // If this ever fails, make sure step 1-4 there were actually done -- the
    // Clerk production origin in particular cannot be read from this repo.
    const enforcing = HEADER_LINES.some((line) =>
      line.toLowerCase().startsWith('content-security-policy:'),
    );
    const reportOnly = HEADER_LINES.some((line) =>
      line.toLowerCase().startsWith('content-security-policy-report-only:'),
    );

    expect(reportOnly).toBe(true);
    expect(enforcing).toBe(false);
  });

  it('allows the inline polyfill by hash rather than unsafe-inline', () => {
    const csp = HEADER_LINES.find((line) =>
      line.toLowerCase().startsWith('content-security-policy-report-only:'),
    );

    expect(csp).toContain("script-src 'self' 'sha256-");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('names the production API origin in connect-src', () => {
    // pages-deploy.yml fails the build if the production Doppler config points
    // REACT_APP_API_URL anywhere else, so this origin is knowable and must be
    // listed -- without it the Report-Only signal is unrepresentative in
    // production, which is where it matters.
    const csp = HEADER_LINES.find((line) =>
      line.toLowerCase().startsWith('content-security-policy-report-only:'),
    );

    expect(csp).toContain('https://api.expirymate.com.au');
  });
});
