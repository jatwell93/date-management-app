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
  switch (event.type) {
    case 'customer.subscription.created':
      await handlers.handleSubscriptionCreated(event.data.object as Stripe.Subscription);
      return;
    case 'customer.subscription.updated':
      await handlers.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
      return;
    case 'customer.subscription.deleted':
      await handlers.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      return;
    case 'checkout.session.completed':
      await handlers.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      return;
    case 'invoice.payment_failed':
      await handlers.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      return;
    case 'customer.subscription.trial_will_end':
      await handlers.handleTrialWillEnd(event.data.object as Stripe.Subscription);
      return;
    case 'payment_intent.succeeded':
      await handlers.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
      return;
    case 'payment_intent.payment_failed':
      await handlers.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
      return;
    default:
      handlers.handleUnhandledEvent(event.type);
  }
}
