import Stripe from 'stripe';
import { StripeWebhookSignatureService } from '../../services/stripe-webhook-signature.service';

describe('StripeWebhookSignatureService', () => {
  it('verifies signatures using Stripe webhook secret', () => {
    const constructEvent = vi.fn().mockReturnValue({ id: 'evt_1' });
    const service = new StripeWebhookSignatureService('sk_test_123', 'whsec_test_123');
    (service as unknown as { stripe: Stripe }).stripe = {
      webhooks: { constructEvent },
    } as unknown as Stripe;

    const result = service.verifySignature(Buffer.from('payload'), 'sig_123');

    expect(constructEvent).toHaveBeenCalledWith(
      Buffer.from('payload'),
      'sig_123',
      'whsec_test_123',
    );
    expect(result).toEqual({ id: 'evt_1' });
  });

  it('throws when stripe secret is missing', () => {
    const service = new StripeWebhookSignatureService(undefined, 'whsec_test_123');

    expect(() => service.verifySignature(Buffer.from('payload'), 'sig_123')).toThrow(
      'STRIPE_SECRET_KEY environment variable is required',
    );
  });
});
