import Stripe from 'stripe';

export interface StripeWebhookEventHandlers {
  handleSubscriptionCreated: (subscription: Stripe.Subscription) => Promise<void>;
  handleSubscriptionUpdated: (subscription: Stripe.Subscription) => Promise<void>;
  handleSubscriptionDeleted: (subscription: Stripe.Subscription) => Promise<void>;
  handleCheckoutSessionCompleted: (session: Stripe.Checkout.Session) => Promise<void>;
  handleInvoicePaymentFailed: (invoice: Stripe.Invoice) => Promise<void>;
  handleTrialWillEnd: (subscription: Stripe.Subscription) => Promise<void>;
  handlePaymentIntentSucceeded: (paymentIntent: Stripe.PaymentIntent) => Promise<void>;
  handlePaymentIntentFailed: (paymentIntent: Stripe.PaymentIntent) => Promise<void>;
  handleUnhandledEvent: (eventType: string) => void;
}

export async function dispatchStripeWebhookEvent(
  event: Stripe.Event,
  handlers: StripeWebhookEventHandlers,
): Promise<void> {
  const dispatchers: Record<string, () => Promise<void>> = {
    'customer.subscription.created': () =>
      handlers.handleSubscriptionCreated(event.data.object as Stripe.Subscription),
    'customer.subscription.updated': () =>
      handlers.handleSubscriptionUpdated(event.data.object as Stripe.Subscription),
    'customer.subscription.deleted': () =>
      handlers.handleSubscriptionDeleted(event.data.object as Stripe.Subscription),
    'checkout.session.completed': () =>
      handlers.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session),
    'invoice.payment_failed': () =>
      handlers.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice),
    'customer.subscription.trial_will_end': () =>
      handlers.handleTrialWillEnd(event.data.object as Stripe.Subscription),
    'payment_intent.succeeded': () =>
      handlers.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent),
    'payment_intent.payment_failed': () =>
      handlers.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent),
  };

  const dispatch = dispatchers[event.type];
  if (dispatch) {
    await dispatch();
    return;
  }

  handlers.handleUnhandledEvent(event.type);
}
