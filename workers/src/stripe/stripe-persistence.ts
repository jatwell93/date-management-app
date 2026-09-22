/**
 * Durable state for the Stripe webhook: the event-idempotency claim, and the
 * subscription row the rest of the Worker gates on.
 *
 * The claim helpers are deliberate copies of `claimClerkWebhookEvent` and its
 * siblings in `../clerk/clerk-persistence.ts`, as `tasks.md` (3.1.b's closing
 * note) directs, against `processed_webhook_events` instead of
 * `clerk_webhook_events`. Migration 0015 gave that table the `completed_at`
 * column the mechanism rests on, for the reasons 0012 set out for its sibling.
 * Keeping the two shapes identical is the point: the Clerk one has real-SQL
 * concurrency coverage, and a Stripe variant that drifted would not inherit it.
 */
import type { Database } from '../database';
import { type LaunchTier } from '../utils/usage-limits';

export type SqlClient = Database['sql'];

/**
 * How long a claim may sit untouched before another delivery may take it over.
 *
 * Matches the Clerk handler's window. It must comfortably exceed the longest
 * healthy processing time and sit below Stripe's retry cadence, so a claim is
 * only ever stolen from an isolate that genuinely died.
 */
export const STRIPE_WEBHOOK_STALE_CLAIM_SECONDS = 60;

export type StripeWebhookClaimOutcome = 'claimed' | 'in_flight' | 'completed';

/**
 * Claim an event id before doing any work.
 *
 * Stripe delivers at least once and retries on timeout or any 5xx, so
 * concurrent redelivery of one event id is the expected case rather than the
 * exotic one. Claiming *after* the work — which is what Express's
 * `isNewEvent` → `handleEvent` → `markEventProcessed` sequence does —
 * deduplicates the marker row while the side effects still run twice.
 *
 * The `ON CONFLICT ... WHERE` clause is what makes this a single statement: the
 * update fires only for a row that is both unfinished and stale, so a live
 * claim is left alone and returns no row.
 *
 * - no row existed — inserted; `claimed`.
 * - row is claimed and stale — the owner died; taken over; `claimed`.
 * - row is claimed and fresh — another delivery owns it; `in_flight`.
 * - row is complete — a replay of finished work; `completed`.
 *
 * The follow-up SELECT is a separate statement on purpose: a subquery in the
 * same statement would read the snapshot taken at statement start and could
 * miss a row committed while this one was blocked on the index. It costs a
 * round trip only on the duplicate path, never on the common one.
 */
export async function claimStripeWebhookEvent(
  sql: SqlClient,
  eventId: string,
  eventType: string,
  staleClaimSeconds: number = STRIPE_WEBHOOK_STALE_CLAIM_SECONDS,
): Promise<StripeWebhookClaimOutcome> {
  const rows = await sql`
    INSERT INTO processed_webhook_events (id, event_type, processed_at, completed_at)
    VALUES (${eventId}, ${eventType}, NOW(), NULL)
    ON CONFLICT (id) DO UPDATE
      SET event_type = EXCLUDED.event_type,
          processed_at = NOW()
      WHERE processed_webhook_events.completed_at IS NULL
        AND processed_webhook_events.processed_at
              < NOW() - make_interval(secs => ${staleClaimSeconds}::double precision)
    RETURNING id
  `;

  if (rows.length > 0) {
    return 'claimed';
  }

  const existing = await sql`
    SELECT completed_at
    FROM processed_webhook_events
    WHERE id = ${eventId}
  `;

  // A row that has vanished between the two statements can only mean the owner
  // released it after failing. Treat that as in-flight: this delivery must stay
  // retryable rather than acknowledge work nobody did.
  if (existing.length === 0) {
    return 'in_flight';
  }

  return existing[0].completed_at === null ? 'in_flight' : 'completed';
}

/**
 * Mark a claimed event finished. Until this runs the row reads as in-flight, so
 * failing to reach it leaves the event replayable once the staleness window
 * expires — the safe direction of the trade.
 */
export async function completeStripeWebhookEvent(sql: SqlClient, eventId: string): Promise<void> {
  await sql`
    UPDATE processed_webhook_events
    SET completed_at = NOW()
    WHERE id = ${eventId}
  `;
}

/**
 * Drop a claim whose processing failed, so Stripe's retry re-drives the event
 * immediately instead of waiting out the staleness window.
 *
 * Guarded on `completed_at IS NULL` so a late failure can never delete the
 * marker of work that actually completed.
 */
export async function releaseStripeWebhookEventClaim(
  sql: SqlClient,
  eventId: string,
): Promise<void> {
  await sql`
    DELETE FROM processed_webhook_events
    WHERE id = ${eventId}
      AND completed_at IS NULL
  `;
}

// ---------------------------------------------------------------------------
// Tier vocabulary
// ---------------------------------------------------------------------------

/**
 * Map the tier named in Stripe price metadata onto this Worker's `LaunchTier`.
 *
 * **This is not `normalizeLaunchTier`, and using that instead would be a live
 * defect.** Express reads `price.metadata.tier` in its own vocabulary — its
 * `TierLevel` is `{free, pro, enterprise}` — while the Worker's is
 * `{free, starter, professional, enterprise}`. `normalizeLaunchTier` has no case
 * for `'pro'`, so it falls through to its `return 'free'` default: a price
 * tagged `tier: 'pro'` would be stored verbatim and then read back by every
 * usage gate as *free*, downgrading a paying organization to the 1 GiB / 500-SKU
 * caps on the strength of the event that confirms their payment. So the
 * translation happens here, at the boundary, and the canonical spelling is what
 * reaches the column.
 *
 * Returning `null` rather than defaulting is the second deliberate divergence.
 * Express's `extractTierFromSubscriptionPrice` returns `'free'` for missing
 * price metadata, unknown values, and a subscription with no line items alike —
 * so a metadata typo on a professional price silently downgrades that customer,
 * and the webhook reports success. `null` means "this event does not tell me the
 * tier", and the caller keeps whatever tier the organization already had.
 */
export function mapStripePriceTier(value: unknown): LaunchTier | null {
  const tier = String(value ?? '')
    .trim()
    .toLowerCase();

  switch (tier) {
    case 'free':
      return 'free';
    case 'starter':
      return 'starter';
    // Express's vocabulary. `pro` is the one that matters: it is what the
    // existing Stripe prices are tagged with, and it is the value
    // `normalizeLaunchTier` silently reads as `free`.
    case 'pro':
    case 'premium':
    case 'professional':
      return 'professional';
    case 'concierge':
    case 'enterprise':
      return 'enterprise';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Subscription state
// ---------------------------------------------------------------------------

export interface StripeSubscriptionSync {
  organizationId: string;
  tier: LaunchTier | null;
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
  status: string;
  billingCycle: 'monthly' | 'annual';
  /** Unix seconds, or null when the subscription is not in a trial. */
  trialEndSeconds: number | null;
  /** Unix seconds, or null when Stripe did not send a period end. */
  currentPeriodEndSeconds: number | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * Resolve the organization a Stripe object belongs to, without calling Stripe.
 *
 * Express asks Stripe itself — `validateWebhookMetadata` does a live
 * `customers.retrieve` and reads `customer.metadata.organizationId`, on the
 * stated ground that Stripe customer metadata is the source of truth
 * (its "DECISION 17.5.5"). That is not carried over, for three reasons: it puts
 * a third-party HTTP round trip inside the critical path of every webhook, where
 * a Stripe outage turns into a retry storm against our own database; it would
 * require `STRIPE_SECRET_KEY` in the Worker purely to answer a question the
 * local schema can already answer; and the answer is one we wrote ourselves when
 * the subscription was created, so the round trip buys no independent
 * confirmation.
 *
 * Instead the resolution is local, most-specific first:
 *
 * 1. `organizationId` in the event object's own metadata — no lookup at all, and
 *    the only source that works for the very first event of a subscription we
 *    have never seen.
 * 2. the `stripe_subscription_id` already on a `subscription_tiers` row.
 * 3. the `stripe_customer_id` already on a `subscription_tiers` row.
 *
 * Returning `null` is meaningful and must not be smoothed over: it means this
 * event cannot be attributed, and the caller must refuse it loudly rather than
 * guess an organization.
 */
export async function resolveOrganizationIdForStripeEvent(
  sql: SqlClient,
  options: {
    metadataOrganizationId?: unknown;
    stripeSubscriptionId?: string | null;
    stripeCustomerId?: string | null;
  },
): Promise<string | null> {
  const fromMetadata = String(options.metadataOrganizationId ?? '').trim();
  if (fromMetadata) {
    // Confirm the organization exists before trusting a value that arrived over
    // the wire. Express does the same check against its organization repository.
    const rows = await sql`
      SELECT id FROM organizations WHERE id = ${fromMetadata} LIMIT 1
    `;
    if (rows.length > 0) {
      return fromMetadata;
    }
  }

  if (options.stripeSubscriptionId) {
    const rows = await sql`
      SELECT organization_id
      FROM subscription_tiers
      WHERE stripe_subscription_id = ${options.stripeSubscriptionId}
      LIMIT 1
    `;
    if (rows.length > 0) {
      return String(rows[0].organization_id);
    }
  }

  if (options.stripeCustomerId) {
    const rows = await sql`
      SELECT organization_id
      FROM subscription_tiers
      WHERE stripe_customer_id = ${options.stripeCustomerId}
      LIMIT 1
    `;
    if (rows.length > 0) {
      return String(rows[0].organization_id);
    }
  }

  return null;
}

/**
 * Write the subscription state a Stripe event carries.
 *
 * **One statement, not a transaction.** Express's `syncSubscriptionTier` reads
 * the existing row and then either creates or updates it — a check-then-act that
 * two deliveries can interleave. Migration 0012 put a unique constraint on
 * `subscription_tiers.organization_id`, which turns the whole thing into one
 * `INSERT ... ON CONFLICT (organization_id) DO UPDATE`. That is genuinely
 * atomic: the conflict is resolved by the index, under the row lock, not by a
 * snapshot this transaction took earlier.
 *
 * **What is deliberately not written.** Express follows every subscription
 * change with `upsertUsage`, writing `max_skus` / `max_users` /
 * `max_inventory_items` into `organization_usage`. Those columns are dead in
 * this Worker and were removed from its read paths on purpose: nothing
 * increments the matching counters, every gate that read them compared `0 >= max`
 * and never fired, and the seeded denominators (`max_users` = a literal `1` for
 * every organization regardless of tier) would have capped a ten-seat
 * professional account at one seat the moment they started being honoured. The
 * Worker resolves caps from `LAUNCH_TIER_LIMITS` by tier instead. Writing those
 * columns here would recreate a second, disagreeing source of truth for
 * entitlements — see the header of `utils/usage-limits.ts`.
 *
 * **`past_due_since` is derived, not accumulated.** Express sets it from
 * `invoice.payment_failed` and clears it from a nightly dunning job, so a
 * customer who fixes their card stays lapsed until that cron next runs — and the
 * Worker has no cron (task 3.1.i). Here the column is a pure function of the
 * status Stripe just sent: set on entering `past_due` and preserved across
 * repeat `past_due` events so the grace window measures from the *first*
 * failure, cleared by any status that is not `past_due`. `subscription-status.ts`
 * reads it with `DUNNING_GRACE_DAYS`, and it is now correct at the instant
 * Stripe tells us, with nothing to maintain it between events.
 *
 * **A null tier preserves the existing one.** See `mapStripePriceTier`: an event
 * that does not identify a recognisable tier must not downgrade anyone. On
 * insert there is no prior value, so `free` is the only available floor and the
 * caller logs it.
 */
export async function upsertSubscriptionFromStripe(
  sql: SqlClient,
  sync: StripeSubscriptionSync,
): Promise<void> {
  const trialEnd = sync.trialEndSeconds === null ? null : new Date(sync.trialEndSeconds * 1000);
  const periodEnd =
    sync.currentPeriodEndSeconds === null ? null : new Date(sync.currentPeriodEndSeconds * 1000);
  const isPastDue = sync.status === 'past_due';

  await sql`
    INSERT INTO subscription_tiers (
      organization_id,
      tier_level,
      stripe_subscription_id,
      stripe_customer_id,
      status,
      billing_cycle,
      trial_end_date,
      current_period_end,
      cancel_at_period_end,
      past_due_since,
      created_at,
      updated_at
    )
    VALUES (
      ${sync.organizationId},
      ${sync.tier ?? 'free'},
      ${sync.stripeSubscriptionId},
      ${sync.stripeCustomerId},
      ${sync.status},
      ${sync.billingCycle},
      ${trialEnd},
      ${periodEnd},
      ${sync.cancelAtPeriodEnd},
      ${isPastDue ? new Date() : null},
      NOW(),
      NOW()
    )
    ON CONFLICT (organization_id) DO UPDATE
      SET tier_level = COALESCE(${sync.tier}, subscription_tiers.tier_level),
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          stripe_customer_id = COALESCE(
            EXCLUDED.stripe_customer_id,
            subscription_tiers.stripe_customer_id
          ),
          status = EXCLUDED.status,
          billing_cycle = EXCLUDED.billing_cycle,
          trial_end_date = EXCLUDED.trial_end_date,
          current_period_end = EXCLUDED.current_period_end,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          past_due_since = CASE
            WHEN ${isPastDue} THEN COALESCE(subscription_tiers.past_due_since, NOW())
            ELSE NULL
          END,
          updated_at = NOW()
  `;
}

/**
 * Record a cancelled subscription.
 *
 * **Express's `tier_level = 'free'` is deliberately not carried over, because in
 * this Worker it would be a live defect.** `deriveSubscriptionAccess` handles a
 * `canceled` row by checking the paid-through window — `cancel_at_period_end`
 * plus `current_period_end` — and, when the customer is still inside it, returns
 * `effectiveTier: storedTier`. Writing `free` into that column at cancellation
 * time would make the window return the free tier, so a customer who cancels
 * mid-period would be dropped to 1 GiB and 500 SKUs immediately despite having
 * paid through the end of the month. The window would still be honoured, and
 * would grant nothing.
 *
 * So the tier is left exactly as it was and the downgrade becomes *derived*
 * rather than written: the moment `current_period_end` passes,
 * `deriveSubscriptionAccess` lapses the organization to `free` on its own, with
 * no writer needed. That is the same move `subscription-status.ts` was built on
 * — state that expires by date rather than by a cron that has to remember to run
 * — and it is why this Worker can drop a scheduled job Express needs.
 *
 * `past_due_since` is cleared because a cancelled subscription is no longer in
 * dunning; the `past_due` branch is unreachable for this row either way, so this
 * only keeps the row honest for anyone reading it directly.
 */
export async function markSubscriptionCanceledFromStripe(
  sql: SqlClient,
  options: {
    organizationId: string;
    stripeSubscriptionId: string;
    currentPeriodEndSeconds: number | null;
    cancelAtPeriodEnd: boolean;
  },
): Promise<void> {
  const periodEnd =
    options.currentPeriodEndSeconds === null
      ? null
      : new Date(options.currentPeriodEndSeconds * 1000);

  await sql`
    UPDATE subscription_tiers
    SET status = 'canceled',
        trial_end_date = NULL,
        past_due_since = NULL,
        cancel_at_period_end = ${options.cancelAtPeriodEnd},
        current_period_end = COALESCE(${periodEnd}, current_period_end),
        updated_at = NOW()
    WHERE organization_id = ${options.organizationId}
  `;
}
