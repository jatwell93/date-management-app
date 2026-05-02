import Stripe from 'stripe';
import { dispatchStripeWebhookEvent } from '../../services/webhook-event-dispatcher';

describe('dispatchStripeWebhookEvent', () => {
  it('routes subscription created events to the subscription handler', async () => {
    const handleSubscriptionCreated = jest.fn().mockResolvedValue(undefined);
    const handlers = {
      handleSubscriptionCreated,
      handleSubscriptionUpdated: jest.fn(),
      handleSubscriptionDeleted: jest.fn(),
      handleCheckoutSessionCompleted: jest.fn(),
      handleInvoicePaymentFailed: jest.fn(),
      handleTrialWillEnd: jest.fn(),
      handlePaymentIntentSucceeded: jest.fn(),
      handlePaymentIntentFailed: jest.fn(),
      handleUnhandledEvent: jest.fn(),
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
      handleSubscriptionCreated: jest.fn(),
      handleSubscriptionUpdated: jest.fn(),
      handleSubscriptionDeleted: jest.fn(),
      handleCheckoutSessionCompleted: jest.fn(),
      handleInvoicePaymentFailed: jest.fn(),
      handleTrialWillEnd: jest.fn(),
      handlePaymentIntentSucceeded: jest.fn(),
      handlePaymentIntentFailed: jest.fn(),
      handleUnhandledEvent: jest.fn(),
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
