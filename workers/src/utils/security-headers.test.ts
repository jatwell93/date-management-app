/**
 * Coverage for the Worker's security response headers (task 3.1.o).
 *
 * Replaces Express's `helmet()`, which the live Worker had no equivalent of.
 * The tests pin the two properties that are easy to break by accident: the
 * headers reach EVERY response (they are applied at a single choke point that
 * a future return statement could bypass), and HSTS is conditional.
 */
import { describe, expect, it } from 'vitest';
import type { Env } from '../types/env';
import { applySecurityHeaders, shouldSendHsts, SECURITY_HEADERS } from './security-headers';

const env = {} as Env;

const httpsRequest = (url = 'https://api.example.com/api/products') => new Request(url);
const httpRequest = (url = 'http://localhost:8787/api/products') => new Request(url);

describe('applySecurityHeaders', () => {
  it('sets nosniff, an API lockdown CSP, referrer and permissions policy', () => {
    const response = applySecurityHeaders(new Response('{}'), httpsRequest(), env);

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    // Not Express's page CSP: the Worker serves no HTML, so script-src and
    // style-src would govern nothing. The frontend's policy lives in
    // frontend/public/_headers instead.
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
  });

  it('sends HSTS over https with Express helmet settings', () => {
    const response = applySecurityHeaders(new Response('{}'), httpsRequest(), env);

    expect(response.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains; preload',
    );
  });

  it('does not send HSTS over plain http', () => {
    // Sending it would be meaningless (clients must ignore HSTS over http) and
    // actively harmful from `wrangler dev`: it would pin localhost to HTTPS in
    // the developer's browser for a year, which reverting this code does not
    // undo.
    const response = applySecurityHeaders(new Response('{}'), httpRequest(), env);

    expect(response.headers.get('Strict-Transport-Security')).toBeNull();
  });

  it('never overwrites a header a handler set deliberately', () => {
    const existing = new Response('{}', {
      headers: { 'Content-Security-Policy': "default-src 'self'" },
    });

    const response = applySecurityHeaders(existing, httpsRequest(), env);

    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
    // The others still apply.
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('preserves status, body and pre-existing headers', () => {
    const original = new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': '42' },
    });

    const response = applySecurityHeaders(original, httpsRequest(), env);

    expect(response.status).toBe(404);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('42');
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('handles a response whose headers are immutable', async () => {
    // A redirect's headers are immutable in the Workers runtime, so the
    // in-place path throws and the rebuild path must take over.
    const redirect = Response.redirect('https://example.com/elsewhere', 302);

    const response = applySecurityHeaders(redirect, httpsRequest(), env);

    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Location')).toBe('https://example.com/elsewhere');
  });

  it('does not set X-Frame-Options, which frame-ancestors supersedes', () => {
    const response = applySecurityHeaders(new Response('{}'), httpsRequest(), env);

    expect(response.headers.get('X-Frame-Options')).toBeNull();
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });
});

describe('shouldSendHsts', () => {
  it('is true only for https', () => {
    expect(shouldSendHsts(httpsRequest())).toBe(true);
    expect(shouldSendHsts(httpRequest())).toBe(false);
  });
});
