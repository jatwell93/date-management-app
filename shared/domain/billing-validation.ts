// Validation for the two caller-supplied values on the billing endpoints: the
// redirect URLs Stripe will send the customer back to, and the price ID they
// are about to be charged against.
//
// Both are security controls, not input hygiene, and both were Express-only
// (`backend/src/utils/url-validator.ts`) until the Worker gained these routes
// in task 3.1.p. They live in `shared/` for the reason
// `shared/domain/csv-injection.ts` gives: a rule enforced in one backend and
// not the other is a rule an attacker picks the backend for. Express is being
// deleted, but until it is, both serve.

/**
 * Reject a redirect URL that would send the customer somewhere we do not own.
 *
 * **This is open-redirect protection on a payment flow.** `success_url` is
 * where Stripe sends the browser after a card is charged; an attacker who can
 * set it to their own domain gets a page that loads immediately after a real
 * payment, in a flow the user already trusts, which is a good place to ask for
 * a password. Stripe does not validate the domain -- it is the caller's job.
 *
 * Relative URLs are allowed unconditionally: they cannot leave the origin.
 *
 * `allowedHostnames` is passed in rather than read from config here so the
 * module stays free of environment access and each backend supplies its own
 * (Express: FRONTEND_URL + CORS_ORIGIN, plus localhost in dev; the Worker:
 * FRONTEND_URL, plus localhost when NODE_ENV is not production).
 */
export function validateRedirectUrl(
  url: unknown,
  fieldName: string,
  allowedHostnames: ReadonlySet<string>,
): void {
  if (!url || typeof url !== 'string') {
    throw new BillingValidationError(`${fieldName} must be a non-empty string`);
  }

  if (url.startsWith('/')) {
    // One exception worth naming: `//evil.com` is protocol-relative and leaves
    // the origin despite starting with a slash. Express's version allowed it.
    if (url.startsWith('//')) {
      throw new BillingValidationError(`${fieldName} must not be protocol-relative`);
    }
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BillingValidationError(`${fieldName} is not a valid URL`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BillingValidationError(`${fieldName} must use http or https protocol`);
  }

  if (!allowedHostnames.has(parsed.hostname)) {
    // The allowed list is deliberately NOT echoed back. Express's message
    // listed every allowed hostname, which hands an unauthenticated prober the
    // deployment's domain configuration for free.
    throw new BillingValidationError(`${fieldName} domain is not allowed`);
  }
}

/**
 * Reject a price ID that is not one this deployment sells.
 *
 * Without the allowlist a caller can name any price in the Stripe account --
 * including a 1-cent test price, or a price belonging to a different product --
 * and check out against it, then be granted the tier the resulting webhook
 * reports. The format check alone is not the control; the allowlist is.
 *
 * An empty allowlist outside development is a *configuration* failure, not a
 * caller error, and is signalled separately so the endpoint can answer 500
 * rather than blame the request.
 */
export function validateStripePriceId(
  priceId: unknown,
  allowedPriceIds: ReadonlySet<string>,
  options: { allowEmptyAllowlist?: boolean } = {},
): void {
  if (!priceId || typeof priceId !== 'string') {
    throw new BillingValidationError('priceId must be a non-empty string');
  }

  if (!priceId.startsWith('price_')) {
    throw new BillingValidationError('priceId must be a valid Stripe price ID');
  }

  if (priceId.length < 10 || priceId.length > 100) {
    throw new BillingValidationError('priceId has invalid length');
  }

  if (allowedPriceIds.size === 0) {
    if (options.allowEmptyAllowlist) {
      return;
    }
    throw new StripePriceConfigurationError();
  }

  if (!allowedPriceIds.has(priceId)) {
    throw new BillingValidationError('priceId is not configured for checkout');
  }
}

/** A caller error: the request is wrong. Maps to 400. */
export class BillingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingValidationError';
  }
}

/** A deployment error: the server is misconfigured. Maps to 500, never 400. */
export class StripePriceConfigurationError extends Error {
  constructor() {
    super('Stripe price IDs are not configured on the server');
    this.name = 'StripePriceConfigurationError';
  }
}
