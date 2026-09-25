/**
 * Coverage for the two billing security controls ported in task 3.1.p
 * (`shared/domain/billing-validation.ts`).
 *
 * Both were Express-only and both guard a payment flow, so they are the part of
 * this port most worth pinning: an open redirect on `success_url` lands the
 * customer on an attacker's page immediately after a real charge, and a missing
 * price allowlist lets a caller check out against any price in the Stripe
 * account and be granted whatever tier the resulting webhook reports.
 */
import { describe, expect, it } from 'vitest';
import {
  BillingValidationError,
  StripePriceConfigurationError,
  validateRedirectUrl,
  validateStripePriceId,
} from '../../../shared/domain/billing-validation';

const ALLOWED = new Set(['app.example.com', 'localhost']);

describe('validateRedirectUrl', () => {
  it('accepts an allowed absolute origin', () => {
    expect(() =>
      validateRedirectUrl('https://app.example.com/billing/done', 'successUrl', ALLOWED),
    ).not.toThrow();
  });

  it('accepts a relative path', () => {
    expect(() => validateRedirectUrl('/settings', 'returnUrl', ALLOWED)).not.toThrow();
  });

  it('rejects a foreign origin', () => {
    // The control. Stripe does not validate the domain; an attacker-supplied
    // success_url renders straight after a genuine payment.
    expect(() =>
      validateRedirectUrl('https://evil.example/harvest', 'successUrl', ALLOWED),
    ).toThrow(BillingValidationError);
  });

  it('rejects every slash-prefixed form that resolves cross-origin', () => {
    // All of these begin with `/` and are not `//`, so a `startsWith('//')`
    // check passes them as "relative" -- and every one resolves to
    // https://evil.example under WHATWG parsing. Backslash is a slash in
    // special schemes; tab, LF and CR are stripped before parsing, which
    // collapses the last three into `//evil.example`.
    //
    // An earlier revision refused only `//`, having reasoned about
    // protocol-relative URLs and stopped there. Found in review of PR #534.
    const escapes = [
      '//evil.example/x',
      '/\\evil.example/x',
      '/\\/evil.example/x',
      '/\t/evil.example/x',
      '/\n/evil.example/x',
      '/\r/evil.example/x',
    ];

    for (const payload of escapes) {
      expect(() => validateRedirectUrl(payload, 'successUrl', ALLOWED), payload).toThrow(
        BillingValidationError,
      );
    }
  });

  it('still accepts ordinary relative paths, including query and fragment', () => {
    // The resolve-and-compare check must not be so strict it refuses the real
    // callers: both send `${origin}/settings?upgraded=true`, and the relative
    // equivalents have to keep working.
    for (const ok of ['/settings', '/settings?upgraded=true', '/settings#billing', '/a/b/c']) {
      expect(() => validateRedirectUrl(ok, 'returnUrl', ALLOWED), ok).not.toThrow();
    }
  });

  it('rejects a javascript: URL whose hostname IS allowlisted', () => {
    // **This payload, not the obvious one.** `javascript:alert(1)` parses to an
    // empty hostname, so it is refused by the allowlist check and says nothing
    // about the protocol check -- mutation testing caught that the obvious test
    // stayed green with the protocol check deleted. `javascript://app.example.com/…`
    // parses to protocol `javascript:` with hostname `app.example.com`, which
    // IS allowlisted, so only the protocol check can refuse it.
    expect(() =>
      validateRedirectUrl('javascript://app.example.com/%0aalert(1)', 'successUrl', ALLOWED),
    ).toThrow(BillingValidationError);
    expect(() => validateRedirectUrl('data://app.example.com/x', 'successUrl', ALLOWED)).toThrow(
      BillingValidationError,
    );
    // The empty-hostname form is still refused, by the allowlist.
    expect(() => validateRedirectUrl('javascript:alert(1)', 'successUrl', ALLOWED)).toThrow(
      BillingValidationError,
    );
  });

  it('rejects an unparseable value and a non-string', () => {
    for (const bad of ['not a url', '', null, undefined, 42]) {
      expect(() => validateRedirectUrl(bad, 'successUrl', ALLOWED)).toThrow(BillingValidationError);
    }
  });

  it('is not fooled by a subdomain or a userinfo prefix of an allowed host', () => {
    // `https://app.example.com@evil.example/` has hostname evil.example --
    // a classic parse-confusion payload.
    expect(() =>
      validateRedirectUrl('https://app.example.com@evil.example/', 'successUrl', ALLOWED),
    ).toThrow(BillingValidationError);
    expect(() =>
      validateRedirectUrl('https://evil.app.example.com/', 'successUrl', ALLOWED),
    ).toThrow(BillingValidationError);
  });

  it('refuses everything absolute when the allowlist is empty', () => {
    expect(() => validateRedirectUrl('https://app.example.com/x', 'successUrl', new Set())).toThrow(
      BillingValidationError,
    );
    // ...but a relative path still cannot leave the origin.
    expect(() => validateRedirectUrl('/x', 'successUrl', new Set())).not.toThrow();
  });

  it('does not echo the allowed hostnames back to the caller', () => {
    // Express's message listed every allowed domain, handing an unauthenticated
    // prober the deployment's configuration.
    try {
      validateRedirectUrl('https://evil.example/', 'successUrl', ALLOWED);
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('app.example.com');
    }
  });
});

describe('validateStripePriceId', () => {
  const ALLOWED_PRICES = new Set(['price_starter_monthly_live', 'price_pro_annual_live']);

  it('accepts a configured price', () => {
    expect(() => validateStripePriceId('price_starter_monthly_live', ALLOWED_PRICES)).not.toThrow();
  });

  it('rejects a well-formed price that is not sold here', () => {
    // The control: format alone is not enough. Any real price in the account
    // would pass a format check.
    expect(() => validateStripePriceId('price_some_other_real_price', ALLOWED_PRICES)).toThrow(
      BillingValidationError,
    );
  });

  it('rejects a malformed price id', () => {
    for (const bad of ['sub_123456789', 'price_', '', null, undefined, 42, 'x'.repeat(200)]) {
      expect(() => validateStripePriceId(bad, ALLOWED_PRICES)).toThrow(BillingValidationError);
    }
  });

  it('signals an unconfigured allowlist distinctly from a bad request', () => {
    // Must not surface as a 400: an empty allowlist is the deployment's fault,
    // and blaming the customer's upgrade request would send them in circles.
    expect(() => validateStripePriceId('price_starter_monthly_live', new Set())).toThrow(
      StripePriceConfigurationError,
    );
  });

  it('permits an empty allowlist only when explicitly opted into', () => {
    expect(() =>
      validateStripePriceId('price_starter_monthly_live', new Set(), {
        allowEmptyAllowlist: true,
      }),
    ).not.toThrow();
  });
});
