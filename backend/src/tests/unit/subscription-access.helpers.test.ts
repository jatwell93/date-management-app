import { hasActiveStripeAccessWindow } from '../../services/subscription-access.helpers';

// Stripe's basil+ API (2026-06-24.dahlia) carries the billing period on each
// subscription item, so the access-window helper reads
// `items.data[0].current_period_end`. Build minimal fixtures matching that shape.
function subscriptionWith(periodEnd: number | null) {
  return {
    items: { data: periodEnd === null ? [] : [{ current_period_end: periodEnd }] },
  };
}

describe('hasActiveStripeAccessWindow', () => {
  it('keeps access open for non-canceled subscriptions', () => {
    expect(
      hasActiveStripeAccessWindow({
        status: 'active',
        cancel_at_period_end: false,
        ...subscriptionWith(null),
      } as never),
    ).toBe(true);
  });

  it('keeps access open for canceled subscriptions until the period ends', () => {
    const futurePeriodEnd = Math.floor(Date.now() / 1000) + 60 * 60;

    expect(
      hasActiveStripeAccessWindow({
        status: 'canceled',
        cancel_at_period_end: true,
        ...subscriptionWith(futurePeriodEnd),
      } as never),
    ).toBe(true);
  });

  it('closes access once the canceled period has ended', () => {
    const pastPeriodEnd = Math.floor(Date.now() / 1000) - 60 * 60;

    expect(
      hasActiveStripeAccessWindow({
        status: 'canceled',
        cancel_at_period_end: true,
        ...subscriptionWith(pastPeriodEnd),
      } as never),
    ).toBe(false);
  });
});
