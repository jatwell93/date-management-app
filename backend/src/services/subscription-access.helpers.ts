import Stripe from 'stripe';
import { getSubscriptionCurrentPeriodEndDate } from './subscription-billing.helpers';

type StripeAccessWindowSubscription = Pick<
  Stripe.Subscription,
  'status' | 'cancel_at_period_end' | 'items'
>;

export function hasActiveStripeAccessWindow(
  stripeSubscription: StripeAccessWindowSubscription,
): boolean {
  if (stripeSubscription.status !== 'canceled') {
    return true;
  }

  const periodEnd = getSubscriptionCurrentPeriodEndDate(stripeSubscription);

  return Boolean(
    stripeSubscription.cancel_at_period_end && periodEnd && periodEnd.getTime() > Date.now(),
  );
}
