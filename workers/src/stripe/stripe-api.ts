import type { Env } from '../types/env';

/**
 * Minimal Stripe REST client for the Worker.
 *
 * **No SDK, deliberately, and for the same reason 3.1.m hand-rolled webhook
 * signature verification**: the surface this Worker needs is four calls, and
 * the `stripe` package is a large dependency to carry into an isolate for four
 * form-encoded POSTs. It also keeps a single story about how this Worker talks
 * to Stripe rather than SDK in one place and Web Crypto in another.
 *
 * What the SDK would have given us and is written out explicitly here instead:
 * idempotency keys (see `stripeRequest`), error shape normalisation
 * ({@link StripeApiError}), and types for the handful of response fields
 * actually read. The first of those is better as a deliberate choice than a
 * default -- an idempotency key on "create a checkout session" has to be
 * derived from something stable, and the SDK cannot know what.
 *
 * Requires `STRIPE_SECRET_KEY`, which the Worker did not have before this task:
 * 3.1.m recorded that its webhook handler "never calls the Stripe API" and
 * resolved organizations from local columns instead. The key bound here should
 * be a **restricted** key with write access to Customers, Checkout Sessions,
 * Billing Portal Sessions and Subscriptions and nothing else, so a compromised
 * Worker cannot issue refunds or read charge history.
 */

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

/**
 * Pinned rather than left to Stripe's account default, so a dashboard-level
 * API-version upgrade cannot change response shapes under a deployed Worker.
 * Matches the version the backend SDK targets (see
 * `subscription-billing.helpers.ts`, which notes the 2025 "basil" move of
 * billing-period fields onto subscription items).
 */
const STRIPE_API_VERSION = '2026-06-24.dahlia';

export class StripeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly stripeCode?: string,
    readonly stripeType?: string,
  ) {
    super(message);
    this.name = 'StripeApiError';
  }
}

export class StripeNotConfiguredError extends Error {
  constructor() {
    super('Stripe is not configured on this deployment');
    this.name = 'StripeNotConfiguredError';
  }
}

/**
 * Flatten a nested object into Stripe's bracketed form encoding.
 *
 * Stripe takes `metadata[organizationId]=org_1` and
 * `line_items[0][price]=price_1`, not JSON. Written here rather than reached
 * for from a library because the shapes are few and the encoding is the part a
 * reader needs to see to check a call against Stripe's docs.
 *
 * `undefined` values are dropped rather than sent as the string "undefined",
 * which is what a naive `String(value)` would do and which Stripe would accept
 * and store.
 */
export function toFormBody(
  input: Record<string, unknown>,
  parentKey?: string,
  out: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    const encodedKey = parentKey ? `${parentKey}[${key}]` : key;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item !== null && typeof item === 'object') {
          toFormBody(item as Record<string, unknown>, `${encodedKey}[${index}]`, out);
        } else if (item !== undefined && item !== null) {
          out.append(`${encodedKey}[${index}]`, String(item));
        }
      });
    } else if (typeof value === 'object') {
      toFormBody(value as Record<string, unknown>, encodedKey, out);
    } else {
      out.append(encodedKey, String(value));
    }
  }
  return out;
}

interface StripeErrorBody {
  error?: { message?: string; code?: string; type?: string };
}

/**
 * One Stripe API call.
 *
 * `idempotencyKey` is optional but should be supplied for every POST that
 * creates or mutates a Stripe object. Without it a retried request -- by the
 * caller, or by a user double-clicking Upgrade -- creates a second customer or
 * a second checkout session. Stripe replays the original response for 24 hours
 * when the key repeats.
 */
async function stripeRequest<T>(
  env: Env,
  path: string,
  options: { body?: Record<string, unknown>; idempotencyKey?: string; method?: string } = {},
): Promise<T> {
  const apiKey = env.STRIPE_SECRET_KEY?.trim();
  if (!apiKey) {
    throw new StripeNotConfiguredError();
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Stripe-Version': STRIPE_API_VERSION,
  };
  if (options.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: options.method ?? 'POST',
    headers,
    body: options.body ? toFormBody(options.body).toString() : undefined,
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new StripeApiError(
      `Stripe returned a non-JSON response (${response.status})`,
      response.status,
    );
  }

  if (!response.ok) {
    const err = (parsed as StripeErrorBody).error;
    throw new StripeApiError(
      err?.message || `Stripe request failed with ${response.status}`,
      response.status,
      err?.code,
      err?.type,
    );
  }

  return parsed as T;
}

// ---------------------------------------------------------------- operations

export interface StripeCustomer {
  id: string;
}

export function createStripeCustomer(
  env: Env,
  input: { email?: string | null; organizationId: string },
  idempotencyKey: string,
): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>(env, '/customers', {
    idempotencyKey,
    body: {
      // `email` is dropped by `toFormBody` when null/undefined rather than sent
      // as an empty string, which Stripe would store as a blank email.
      email: input.email ?? undefined,
      metadata: { organizationId: input.organizationId },
    },
  });
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
}

export function createStripeCheckoutSession(
  env: Env,
  input: {
    customerId: string;
    priceId: string;
    successUrl: string;
    cancelUrl: string;
    organizationId: string;
  },
  idempotencyKey: string,
): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>(env, '/checkout/sessions', {
    idempotencyKey,
    body: {
      customer: input.customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // Metadata on the SESSION, as Express set it. Useful for
      // `checkout.session.completed`, which this Worker does not handle.
      metadata: { organizationId: input.organizationId },
      // **The fix 3.1.m carried forward, and the reason this endpoint mattered
      // most of the four.** Session metadata does NOT propagate to the
      // subscription Stripe creates. Express set only the former, so
      // `customer.subscription.created` arrived with no `organizationId` and
      // the webhook could attribute it only by `stripe_customer_id` -- which
      // works for an organization that already has one, and fails for a
      // genuinely new subscriber, exactly the case a checkout session
      // represents. `subscription_data.metadata` rides onto the subscription
      // itself, so every future subscription event names its organization.
      subscription_data: { metadata: { organizationId: input.organizationId } },
    },
  });
}

export interface StripeBillingPortalSession {
  url: string;
}

export function createStripeBillingPortalSession(
  env: Env,
  input: { customerId: string; returnUrl: string },
  idempotencyKey: string,
): Promise<StripeBillingPortalSession> {
  return stripeRequest<StripeBillingPortalSession>(env, '/billing_portal/sessions', {
    idempotencyKey,
    body: { customer: input.customerId, return_url: input.returnUrl },
  });
}

export interface StripeSubscription {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
}

/**
 * Cancel at period end -- the customer keeps access until the paid-through date.
 *
 * No idempotency key: this is a set-to-a-value update rather than a create, so
 * repeating it converges on the same state. Stripe rejects idempotency keys
 * reused with a different body, which would make a legitimate retry after an
 * edit fail confusingly.
 */
export function cancelStripeSubscriptionAtPeriodEnd(
  env: Env,
  subscriptionId: string,
): Promise<StripeSubscription> {
  return stripeRequest<StripeSubscription>(
    env,
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      body: { cancel_at_period_end: true },
    },
  );
}
