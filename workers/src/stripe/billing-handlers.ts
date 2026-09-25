import type { Database } from '../database';
import type { Env } from '../types/env';
import { errorResponse, jsonResponse } from '../utils/worker-response';
import {
  BillingValidationError,
  StripePriceConfigurationError,
  validateRedirectUrl,
  validateStripePriceId,
} from '../../../shared/domain/billing-validation';
import {
  StripeApiError,
  StripeNotConfiguredError,
  cancelStripeSubscriptionAtPeriodEnd,
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  createStripeCustomer,
} from './stripe-api';

/**
 * The three customer-facing billing endpoints (task 3.1.p):
 * `POST /api/subscription/create-checkout-session`, `.../cancel` and
 * `.../create-portal-session`.
 *
 * **These were not merely unported -- they were broken.** All three have live
 * frontend callers (`TrialUpgradeFlow.tsx`, `SubscriptionSettingsPage.tsx`,
 * `ManageSubscriptionButton.tsx`) which reach them through `buildApiUrl`, and
 * in production that resolves to this Worker. The Worker served only
 * `/current` and `/trial-status`, so upgrade, cancel and "manage billing" were
 * answering 404 to real users. The 2.1 matrix classified them `rehome` for the
 * migration; the more immediate fact is that the billing UI had no working
 * back end.
 *
 * The fourth Express route, `POST /api/subscription/convert-trial`, is
 * deliberately NOT ported. It has no caller: the matrix cited
 * `TrialUpgradeFlow.tsx:188` as its consumer, but that line calls
 * `create-checkout-session`, and the only `convert-trial` match in the frontend
 * is the string "Failed to convert trial" in an error branch at `:203`.
 * Retiring it removes a payment-method-taking, Stripe-mutating endpoint that
 * nothing exercises.
 */

/**
 * Hostnames a post-checkout redirect may target.
 *
 * Express built this from FRONTEND_URL + CORS_ORIGIN, adding localhost in
 * development. The Worker has no CORS_ORIGIN -- `getCorsHeaders` uses
 * FRONTEND_URL -- so the set is that plus localhost off production.
 */
function allowedRedirectHostnames(env: Env): Set<string> {
  const allowed = new Set<string>();
  if (env.FRONTEND_URL) {
    try {
      allowed.add(new URL(env.FRONTEND_URL).hostname);
    } catch {
      // A malformed FRONTEND_URL must not widen the allowlist; it narrows it,
      // and every absolute redirect is then refused. Loud failure beats a
      // silently permissive redirect check on a payment flow.
    }
  }
  if (env.NODE_ENV !== 'production') {
    allowed.add('localhost');
    allowed.add('127.0.0.1');
    allowed.add('[::1]');
  }
  return allowed;
}

/**
 * The price IDs this deployment sells, from the same four env keys Express
 * reads (`subscription-billing.helpers.ts` `STRIPE_PRICE_CATALOG`).
 *
 * Express also falls back to placeholder ids (`price_starter_monthly` and
 * friends) in development and test. That fallback is not reproduced: a
 * placeholder is not a real Stripe price, so allowing it only converts a clear
 * "not configured" error into an opaque Stripe 400 later in the flow.
 */
function allowedPriceIds(env: Env): Set<string> {
  const keys = [
    env.STRIPE_STARTER_MONTHLY_PRICE_ID,
    env.STRIPE_STARTER_ANNUAL_PRICE_ID,
    env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID,
    env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID,
  ];
  return new Set(keys.filter((k): k is string => typeof k === 'string' && k.length > 0));
}

interface SubscriptionRow {
  id: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

async function loadSubscription(
  db: Database,
  organizationId: string,
): Promise<SubscriptionRow | null> {
  const rows = await db.sql`
    SELECT id, stripe_customer_id, stripe_subscription_id
    FROM subscription_tiers
    WHERE organization_id = ${organizationId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] as SubscriptionRow | undefined) ?? null;
}

/**
 * Turn a thrown error into the response Express would have produced.
 *
 * `StripePriceConfigurationError` maps to 500 rather than 400 on purpose: an
 * unconfigured price list is the deployment's fault, and answering 400 would
 * tell the customer their perfectly valid upgrade request was malformed.
 */
function billingErrorResponse(error: unknown, env: Env, context: string): Response {
  if (error instanceof BillingValidationError) {
    return errorResponse(error.message, 400, env);
  }
  if (error instanceof StripePriceConfigurationError) {
    console.error(JSON.stringify({ event: 'stripe_prices_unconfigured', context }));
    return errorResponse('Billing is not configured on this deployment', 500, env);
  }
  if (error instanceof StripeNotConfiguredError) {
    // 503, not 500: the deployment is missing a secret, which is a temporary
    // operational state an operator fixes -- the same shape 3.1.m chose for the
    // Stripe webhook receiver before its secret was bound.
    console.error(JSON.stringify({ event: 'stripe_secret_key_missing', context }));
    return errorResponse('Billing is temporarily unavailable', 503, env);
  }
  if (error instanceof StripeApiError) {
    console.error(
      JSON.stringify({
        event: 'stripe_api_error',
        context,
        status: error.status,
        code: error.stripeCode,
        type: error.stripeType,
      }),
    );
    // Stripe's own message is not forwarded: it can name internal object ids
    // and account configuration.
    return errorResponse('Payment provider request failed', 502, env);
  }
  console.error(
    JSON.stringify({
      event: 'billing_handler_error',
      context,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  return errorResponse('Internal server error', 500, env);
}

/**
 * POST /api/subscription/create-checkout-session
 *
 * Two divergences from Express, both fixes.
 *
 * **1. The subscription carries `organizationId`.** Express set metadata only
 * on the checkout session, which does not propagate to the subscription Stripe
 * creates -- see `createStripeCheckoutSession`. This is 3.1.m's carry-forward.
 *
 * **2. A newly created Stripe customer is always persisted.** Express wrote the
 * id back only `if (subscription)`, so an organization with no
 * `subscription_tiers` row got a fresh Stripe customer created and its id
 * thrown away, on every single attempt -- accumulating orphan customers and
 * guaranteeing the webhook could never attribute by customer id. Here the
 * absence of a row is refused up front instead: without one there is nowhere to
 * record the customer, and proceeding would repeat Express's leak.
 */
export async function handleCreateCheckoutSession(
  request: Request,
  db: Database,
  env: Env,
  organizationId: string,
): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as {
      priceId?: unknown;
      successUrl?: unknown;
      cancelUrl?: unknown;
    } | null;
    if (!body) {
      throw new BillingValidationError('Invalid request body');
    }

    const hostnames = allowedRedirectHostnames(env);
    validateStripePriceId(body.priceId, allowedPriceIds(env));
    validateRedirectUrl(body.successUrl, 'successUrl', hostnames);
    validateRedirectUrl(body.cancelUrl, 'cancelUrl', hostnames);

    const subscription = await loadSubscription(db, organizationId);
    if (!subscription) {
      // See the doc comment: Express created a Stripe customer here and
      // discarded the id. Refusing is the honest answer -- every organization
      // gets a subscription_tiers row at bootstrap, so this means something is
      // already wrong.
      console.error(JSON.stringify({ event: 'checkout_without_subscription_row', organizationId }));
      return errorResponse('No billing record found for this organization', 404, env);
    }

    let customerId = subscription.stripe_customer_id;
    if (!customerId) {
      const orgRows = await db.sql`
        SELECT contact_email FROM organizations WHERE id = ${organizationId} LIMIT 1
      `;
      const contactEmail = (orgRows[0] as { contact_email: string | null } | undefined)
        ?.contact_email;

      // Keyed on the organization so a double-clicked Upgrade replays the first
      // customer rather than creating a second.
      const customer = await createStripeCustomer(
        env,
        { email: contactEmail, organizationId },
        `customer:${organizationId}`,
      );
      customerId = customer.id;

      await db.sql`
        UPDATE subscription_tiers
        SET stripe_customer_id = ${customerId}, updated_at = NOW()
        WHERE id = ${subscription.id} AND stripe_customer_id IS NULL
      `;
    }

    const session = await createStripeCheckoutSession(
      env,
      {
        customerId,
        priceId: body.priceId as string,
        successUrl: body.successUrl as string,
        cancelUrl: body.cancelUrl as string,
        organizationId,
      },
      // Deliberately NOT keyed on the organization alone: a customer who
      // abandons checkout and returns must get a new session, and Stripe
      // replays a reused key for 24 hours. Keyed on the intent instead, so only
      // a genuine double-submit of the same upgrade collapses.
      `checkout:${organizationId}:${body.priceId as string}:${Math.floor(Date.now() / 60000)}`,
    );

    return jsonResponse({ sessionId: session.id, url: session.url }, 200, env);
  } catch (error) {
    return billingErrorResponse(error, env, 'create-checkout-session');
  }
}

/**
 * POST /api/subscription/cancel
 *
 * Cancels at period end, as Express did: the customer keeps the tier they paid
 * for until `current_period_end`. The local row is updated from Stripe's
 * response rather than assumed, so a Stripe-side state we did not expect is
 * recorded rather than overwritten with an optimistic guess.
 *
 * The tier level is deliberately left alone -- `deriveSubscriptionAccess`
 * honours the paid-through window by returning the stored tier, and writing
 * `free` here would revoke access the customer has already paid for. Same
 * reasoning as 3.1.m's cancellation handler.
 */
export async function handleCancelSubscription(
  _request: Request,
  db: Database,
  env: Env,
  organizationId: string,
): Promise<Response> {
  try {
    const subscription = await loadSubscription(db, organizationId);
    if (!subscription?.stripe_subscription_id) {
      return errorResponse('No active subscription found', 404, env);
    }

    const canceled = await cancelStripeSubscriptionAtPeriodEnd(
      env,
      subscription.stripe_subscription_id,
    );

    await db.sql`
      UPDATE subscription_tiers
      SET status = ${canceled.status},
          cancel_at_period_end = ${canceled.cancel_at_period_end},
          updated_at = NOW()
      WHERE id = ${subscription.id}
        AND stripe_subscription_id = ${subscription.stripe_subscription_id}
    `;

    return jsonResponse({ success: true }, 200, env);
  } catch (error) {
    return billingErrorResponse(error, env, 'cancel-subscription');
  }
}

/**
 * POST /api/subscription/create-portal-session
 *
 * 402 rather than 404 when there is no Stripe customer, preserving Express's
 * deliberate choice: "no org, no subscription, or no Stripe customer all mean
 * the same thing from the caller's perspective -- there is no billing account
 * to manage", and 402 lets the frontend prompt to subscribe instead of showing
 * an error.
 */
export async function handleCreatePortalSession(
  request: Request,
  db: Database,
  env: Env,
  organizationId: string,
): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { returnUrl?: unknown };

    let returnUrl: string;
    if (body.returnUrl !== undefined && body.returnUrl !== null && body.returnUrl !== '') {
      validateRedirectUrl(body.returnUrl, 'returnUrl', allowedRedirectHostnames(env));
      returnUrl = body.returnUrl as string;
    } else {
      returnUrl = `${(env.FRONTEND_URL || '').replace(/\/+$/, '')}/settings`;
    }

    const subscription = await loadSubscription(db, organizationId);
    if (!subscription?.stripe_customer_id) {
      return errorResponse(
        'No active billing account found. Subscribe to a paid plan to manage billing.',
        402,
        env,
      );
    }

    const session = await createStripeBillingPortalSession(
      env,
      { customerId: subscription.stripe_customer_id, returnUrl },
      // Minute-bucketed like checkout: a portal session is short-lived and a
      // returning customer must be able to open a fresh one.
      `portal:${organizationId}:${Math.floor(Date.now() / 60000)}`,
    );

    return jsonResponse({ url: session.url }, 200, env);
  } catch (error) {
    return billingErrorResponse(error, env, 'create-portal-session');
  }
}
