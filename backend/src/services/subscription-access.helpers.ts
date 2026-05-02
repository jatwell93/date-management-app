import Stripe from 'stripe';

type StripeAccessWindowSubscription = Pick<
  Stripe.Subscription,
  'status' | 'cancel_at_period_end' | 'current_period_end'
>;

export function hasActiveStripeAccessWindow(
  stripeSubscription: StripeAccessWindowSubscription,
): boolean {
  if (stripeSubscription.status !== 'canceled') {
    return true;
  }

  const periodEnd = stripeSubscription.current_period_end
    ? new Date(stripeSubscription.current_period_end * 1000)
    : null;

  return Boolean(
    stripeSubscription.cancel_at_period_end && periodEnd && periodEnd.getTime() > Date.now(),
  );
}
