import { hasActiveStripeAccessWindow } from '../../services/subscription-access.helpers';

describe('hasActiveStripeAccessWindow', () => {
  it('keeps access open for non-canceled subscriptions', () => {
    expect(
      hasActiveStripeAccessWindow({
        status: 'active',
        cancel_at_period_end: false,
        current_period_end: null,
      } as never),
    ).toBe(true);
  });

  it('keeps access open for canceled subscriptions until the period ends', () => {
    const futurePeriodEnd = Math.floor(Date.now() / 1000) + 60 * 60;

    expect(
      hasActiveStripeAccessWindow({
        status: 'canceled',
        cancel_at_period_end: true,
        current_period_end: futurePeriodEnd,
      } as never),
    ).toBe(true);
  });

  it('closes access once the canceled period has ended', () => {
    const pastPeriodEnd = Math.floor(Date.now() / 1000) - 60 * 60;

    expect(
      hasActiveStripeAccessWindow({
        status: 'canceled',
        cancel_at_period_end: true,
        current_period_end: pastPeriodEnd,
      } as never),
    ).toBe(false);
  });
});
