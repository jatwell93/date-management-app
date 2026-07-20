import Stripe from 'stripe';
import { dispatchStripeWebhookEvent } from '../../services/webhook-event-dispatcher';

describe('dispatchStripeWebhookEvent', () => {
  it('routes subscription created events to the subscription handler', async () => {
    const handleSubscriptionCreated = vi.fn().mockResolvedValue(undefined);
    const handlers = {
      handleSubscriptionCreated,
      handleSubscriptionUpdated: vi.fn(),
      handleSubscriptionDeleted: vi.fn(),
      handleCheckoutSessionCompleted: vi.fn(),
      handleInvoicePaymentFailed: vi.fn(),
      handleTrialWillEnd: vi.fn(),
      handlePaymentIntentSucceeded: vi.fn(),
      handlePaymentIntentFailed: vi.fn(),
      handleUnhandledEvent: vi.fn(),
    };

    const event = {
      id: 'evt_1',
      type: 'customer.subscription.created',
      data: { object: { id: 'sub_1' } },
    } as unknown as Stripe.Event;

    await dispatchStripeWebhookEvent(event, handlers);

    expect(handleSubscriptionCreated).toHaveBeenCalledWith({ id: 'sub_1' });
    expect(handlers.handleUnhandledEvent).not.toHaveBeenCalled();
  });

  it('routes unknown events to the unhandled callback', async () => {
    const handlers = {
      handleSubscriptionCreated: vi.fn(),
      handleSubscriptionUpdated: vi.fn(),
      handleSubscriptionDeleted: vi.fn(),
      handleCheckoutSessionCompleted: vi.fn(),
      handleInvoicePaymentFailed: vi.fn(),
      handleTrialWillEnd: vi.fn(),
      handlePaymentIntentSucceeded: vi.fn(),
      handlePaymentIntentFailed: vi.fn(),
      handleUnhandledEvent: vi.fn(),
    };

    const event = {
      id: 'evt_2',
      type: 'charge.refunded',
      data: { object: {} },
    } as unknown as Stripe.Event;

    await dispatchStripeWebhookEvent(event, handlers);

    expect(handlers.handleUnhandledEvent).toHaveBeenCalledWith('charge.refunded');
  });
});
