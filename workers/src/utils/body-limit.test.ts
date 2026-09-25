/**
 * Coverage for the JSON request-body cap (task 3.1.o).
 *
 * Express capped JSON at 10 MB; the Worker capped nothing. The cap matters more
 * here than it did there: `request.json()` buffers the whole body into an
 * isolate shared with other tenants' concurrent requests.
 */
import { describe, expect, it } from 'vitest';
import type { Env } from '../types/env';
import {
  DEFAULT_MAX_JSON_BODY_BYTES,
  enforceJsonBodyLimit,
  resolveMaxJsonBodyBytes,
} from './body-limit';

const env = {} as Env;

const post = (contentLength?: string, method = 'POST') =>
  new Request('https://api.example.com/api/products', {
    method,
    ...(contentLength === undefined ? {} : { headers: { 'Content-Length': contentLength } }),
  });

describe('resolveMaxJsonBodyBytes', () => {
  it('defaults to 1 MiB', () => {
    expect(resolveMaxJsonBodyBytes(env)).toBe(1024 * 1024);
    expect(DEFAULT_MAX_JSON_BODY_BYTES).toBe(1024 * 1024);
  });

  it('honours a valid override', () => {
    expect(resolveMaxJsonBodyBytes({ MAX_JSON_BODY_BYTES: '2048' } as unknown as Env)).toBe(2048);
  });

  it('falls back rather than uncapping on a malformed override', () => {
    // The dangerous failure is NaN: `size > NaN` is false, so a typo would
    // silently disable the cap rather than fail loudly.
    for (const bad of ['not-a-number', '', '0', '-5']) {
      expect(resolveMaxJsonBodyBytes({ MAX_JSON_BODY_BYTES: bad } as unknown as Env)).toBe(
        DEFAULT_MAX_JSON_BODY_BYTES,
      );
    }
  });
});

describe('enforceJsonBodyLimit', () => {
  it('allows a body within the cap', () => {
    expect(enforceJsonBodyLimit(post('1024'), env)).toBeNull();
  });

  it('allows a body exactly at the cap', () => {
    expect(enforceJsonBodyLimit(post(String(DEFAULT_MAX_JSON_BODY_BYTES)), env)).toBeNull();
  });

  it('refuses a body one byte over the cap with 413', async () => {
    const response = enforceJsonBodyLimit(post(String(DEFAULT_MAX_JSON_BODY_BYTES + 1)), env);

    expect(response?.status).toBe(413);
    await expect(response?.json()).resolves.toMatchObject({
      error: expect.stringContaining('1048576'),
    });
  });

  it('ignores body-less methods', () => {
    // Some clients send Content-Length: 0 on GET.
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(enforceJsonBodyLimit(post('99999999', method), env)).toBeNull();
    }
  });

  it('allows a request with no Content-Length', () => {
    // Documented limitation, not an oversight: a chunked request declares no
    // length, and the alternative -- streaming every body through a counter --
    // is the cost this cap exists to avoid. Cloudflare enforces its own hard
    // ceiling upstream.
    expect(enforceJsonBodyLimit(post(undefined), env)).toBeNull();
  });

  it('allows a request whose Content-Length is not a number', () => {
    expect(enforceJsonBodyLimit(post('abc'), env)).toBeNull();
  });

  it('applies the override to the decision, not just the message', async () => {
    const tiny = { MAX_JSON_BODY_BYTES: '100' } as unknown as Env;

    expect(enforceJsonBodyLimit(post('50'), tiny)).toBeNull();
    const response = enforceJsonBodyLimit(post('101'), tiny);
    expect(response?.status).toBe(413);
    await expect(response?.json()).resolves.toMatchObject({
      error: expect.stringContaining('100'),
    });
  });
});
