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
  DEFAULT_MAX_WEBHOOK_BODY_BYTES,
  capUndeclaredBody,
  capWebhookBody,
  resolveMaxWebhookBodyBytes,
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

  it('leaves a request with no Content-Length to capUndeclaredBody', () => {
    // The header check cannot judge an undeclared length; capUndeclaredBody does.
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

describe('capUndeclaredBody (#532)', () => {
  const tiny = { MAX_JSON_BODY_BYTES: '100' } as unknown as Env;

  const streamed = (chunks: string[], extraHeaders: Record<string, string> = {}) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Request('https://api.example.com/api/products', {
      method: 'POST',
      headers: extraHeaders,
      body,
      duplex: 'half',
    } as RequestInit);
  };

  it('returns a readable, equivalent request for a chunked body within the cap', async () => {
    const result = await capUndeclaredBody(streamed(['{"a":', '1}'], { 'X-Keep': 'yes' }), tiny);

    expect(result).toBeInstanceOf(Request);
    const rebuilt = result as Request;
    expect(rebuilt.method).toBe('POST');
    expect(rebuilt.headers.get('X-Keep')).toBe('yes');
    await expect(rebuilt.json()).resolves.toEqual({ a: 1 });
  });

  it('accepts a chunked body exactly at the cap', async () => {
    const result = await capUndeclaredBody(streamed(['x'.repeat(60), 'y'.repeat(40)]), tiny);

    expect(result).toBeInstanceOf(Request);
    expect(await (result as Request).text()).toHaveLength(100);
  });

  it('refuses a chunked body one byte over the cap with 413', async () => {
    const result = await capUndeclaredBody(streamed(['x'.repeat(60), 'y'.repeat(41)]), tiny);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
    await expect((result as Response).json()).resolves.toMatchObject({
      error: expect.stringContaining('100'),
    });
  });

  it('stops reading once the cap is passed', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(60));
      },
    });
    const request = new Request('https://api.example.com/api/products', {
      method: 'POST',
      body,
      duplex: 'half',
    } as RequestInit);

    const result = await capUndeclaredBody(request, tiny);

    expect((result as Response).status).toBe(413);
    // An endless stream would hang here if the reader kept going.
    expect(pulled).toBeLessThan(10);
  });

  it('treats a non-numeric Content-Length as undeclared', async () => {
    const result = await capUndeclaredBody(
      streamed(['x'.repeat(200)], { 'Content-Length': 'abc' }),
      tiny,
    );

    expect((result as Response).status).toBe(413);
  });

  it('returns a request with a numeric Content-Length unchanged', async () => {
    const request = new Request('https://api.example.com/api/products', {
      method: 'POST',
      headers: { 'Content-Length': '5' },
      body: 'hello',
    });

    expect(await capUndeclaredBody(request, tiny)).toBe(request);
  });

  it('returns body-less methods and body-less requests unchanged', async () => {
    const get = new Request('https://api.example.com/api/products');
    const bodiless = new Request('https://api.example.com/api/products', { method: 'POST' });

    expect(await capUndeclaredBody(get, tiny)).toBe(get);
    expect(await capUndeclaredBody(bodiless, tiny)).toBe(bodiless);
  });
});

describe('capWebhookBody (#532 follow-up)', () => {
  const small = { MAX_WEBHOOK_BODY_BYTES: '100' } as unknown as Env;

  it('defaults to 2 MiB and falls back on a malformed override', () => {
    expect(DEFAULT_MAX_WEBHOOK_BODY_BYTES).toBe(2 * 1024 * 1024);
    expect(resolveMaxWebhookBodyBytes(env)).toBe(DEFAULT_MAX_WEBHOOK_BODY_BYTES);
    for (const bad of ['nope', '', '0', '-1']) {
      expect(resolveMaxWebhookBodyBytes({ MAX_WEBHOOK_BODY_BYTES: bad } as unknown as Env)).toBe(
        DEFAULT_MAX_WEBHOOK_BODY_BYTES,
      );
    }
  });

  it('is independent of the JSON cap', () => {
    const jsonOnly = { MAX_JSON_BODY_BYTES: '10' } as unknown as Env;
    expect(resolveMaxWebhookBodyBytes(jsonOnly)).toBe(DEFAULT_MAX_WEBHOOK_BODY_BYTES);
  });

  it('refuses a declared length over the cap and passes one within it', async () => {
    const over = await capWebhookBody(post('101'), small);
    expect((over as Response).status).toBe(413);

    const at = post('100');
    expect(await capWebhookBody(at, small)).toBe(at);
  });

  it('refuses an undeclared body over the cap and rebuilds one within it', async () => {
    const stream = (text: string) =>
      new Request('https://api.example.com/api/webhooks/stripe', {
        method: 'POST',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(text));
            controller.close();
          },
        }),
        duplex: 'half',
      } as RequestInit);

    const over = await capWebhookBody(stream('x'.repeat(101)), small);
    expect((over as Response).status).toBe(413);

    const within = await capWebhookBody(stream('x'.repeat(100)), small);
    expect(await (within as Request).text()).toHaveLength(100);
  });
});
