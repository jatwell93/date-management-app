import Stripe from 'stripe';

const log = {
  error: (message: string, data?: Record<string, unknown>) => {
    console.error(`[WEBHOOK] ${message}`, data ? JSON.stringify(data) : '');
  },
};

export class StripeWebhookSignatureService {
  private stripe: Stripe | null;
  private webhookSecret?: string;

  constructor(stripeSecretKey?: string, webhookSecret?: string) {
    this.webhookSecret = webhookSecret;

    if (stripeSecretKey) {
      this.stripe = new Stripe(stripeSecretKey, {
        apiVersion: '2026-06-24.dahlia',
      });
    } else {
      this.stripe = null;
    }
  }

  verifySignature(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.stripe) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }

    if (!this.webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required');
    }

    try {
      return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (error) {
      const err = error as Error;
      log.error('Stripe signature verification failed', {
        error: err.message,
        signatureStatus: 'verification_failed',
      });
      throw new Error(`Webhook Error: ${err.message}`);
    }
  }
}
