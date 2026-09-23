import { describe, expect, it } from 'vitest';

import { parseStripeSignatureHeader, verifyStripeSignature } from './webhook-signature';

const SECRET = 'whsec_test_gYtHY4nGpQ3rWvZ9kL2mXcB8dF6sJ1aE';

/**
 * Produce a genuine Stripe signature the way Stripe does.
 *
 * Deliberately built here with Web Crypto rather than by calling into the module
 * under test: a helper that reused `verifyStripeSignature`'s own digest would
 * agree with it no matter how wrong both were, which is the "green because the
 * harness cannot fail" trap. Note the secret goes in verbatim — no base64
 * decode, no stripping of `whsec_`. That is the Stripe/Svix difference the
 * module exists to get right, and encoding it independently here is what makes
 * these assertions evidence.
 */
async function signStripePayload(
  payload: string,
  timestamp: number,
  secret: string = SECRET,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

const BODY = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated' });

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

describe('parseStripeSignatureHeader', () => {
  it('reads the timestamp and every v1 signature', () => {
    const parsed = parseStripeSignatureHeader('t=1700000000,v1=aaaa,v0=ignored,v1=bbbb');

    expect(parsed).toEqual({ timestamp: 1700000000, v1Signatures: ['aaaa', 'bbbb'] });
  });

  it('rejects a timestamp that is not entirely digits', () => {
    // `Number.parseInt('12abc', 10)` is 12, not NaN, so a laxer parser would
    // accept this header and then verify against the wrong signed payload.
    expect(parseStripeSignatureHeader('t=12abc,v1=aaaa')).toBeNull();
  });

  it('rejects a header carrying no v1 signature', () => {
    expect(parseStripeSignatureHeader('t=1700000000,v0=aaaa')).toBeNull();
  });

  it('rejects an empty header', () => {
    expect(parseStripeSignatureHeader('')).toBeNull();
  });
});

describe('verifyStripeSignature', () => {
  it('accepts a signature Stripe would have produced', async () => {
    const timestamp = nowSeconds();
    const signature = await signStripePayload(BODY, timestamp);

    await expect(
      verifyStripeSignature(BODY, `t=${timestamp},v1=${signature}`, SECRET),
    ).resolves.toBeUndefined();
  });

  it('accepts the second signature during an endpoint-secret rotation', async () => {
    // Stripe sends one v1 per active secret while a roll is in progress. Only
    // the second one here is ours; stopping at the first would drop half the
    // deliveries for the duration of every rotation.
    const timestamp = nowSeconds();
    const ours = await signStripePayload(BODY, timestamp);
    const theOldSecrets = await signStripePayload(BODY, timestamp, 'whsec_previous_secret');

    await expect(
      verifyStripeSignature(BODY, `t=${timestamp},v1=${theOldSecrets},v1=${ours}`, SECRET),
    ).resolves.toBeUndefined();
  });

  it('rejects a body that was altered after signing', async () => {
    const timestamp = nowSeconds();
    const signature = await signStripePayload(BODY, timestamp);
    const tampered = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.deleted' });

    await expect(
      verifyStripeSignature(tampered, `t=${timestamp},v1=${signature}`, SECRET),
    ).rejects.toThrow('Invalid Stripe webhook signature');
  });

  it('rejects a signature made with a different secret', async () => {
    const timestamp = nowSeconds();
    const signature = await signStripePayload(BODY, timestamp, 'whsec_not_our_secret');

    await expect(
      verifyStripeSignature(BODY, `t=${timestamp},v1=${signature}`, SECRET),
    ).rejects.toThrow('Invalid Stripe webhook signature');
  });

  it('rejects a replay from outside the tolerance window', async () => {
    const timestamp = nowSeconds() - 6 * 60;
    // Correctly signed for its own timestamp — the signature is valid and the
    // age alone is what refuses it.
    const signature = await signStripePayload(BODY, timestamp);

    await expect(
      verifyStripeSignature(BODY, `t=${timestamp},v1=${signature}`, SECRET),
    ).rejects.toThrow('Webhook timestamp outside allowed window');
  });

  it('rejects a timestamp too far in the future', async () => {
    const timestamp = nowSeconds() + 6 * 60;
    const signature = await signStripePayload(BODY, timestamp);

    await expect(
      verifyStripeSignature(BODY, `t=${timestamp},v1=${signature}`, SECRET),
    ).rejects.toThrow('Webhook timestamp outside allowed window');
  });

  it('rejects a malformed header before doing any crypto', async () => {
    await expect(verifyStripeSignature(BODY, 'not-a-signature', SECRET)).rejects.toThrow(
      'Invalid stripe-signature header',
    );
  });

  it('does not base64-decode the secret the way the Clerk verifier does', async () => {
    // The trap this module exists to avoid. `whsec_` + base64url is exactly the
    // shape `decodeClerkWebhookSecret` decodes, so a copy-paste of the Clerk
    // helper would key the HMAC off the decoded bytes and reject this signature
    // — which is genuine, and which Stripe's own libraries accept.
    const stripeShapedSecret = 'whsec_dGVzdFNlY3JldFZhbHVlMTIzNDU2Nzg5MA';
    const timestamp = nowSeconds();
    const signature = await signStripePayload(BODY, timestamp, stripeShapedSecret);

    await expect(
      verifyStripeSignature(BODY, `t=${timestamp},v1=${signature}`, stripeShapedSecret),
    ).resolves.toBeUndefined();
  });

  it('is case-insensitive about the hex digest Stripe sends', async () => {
    const timestamp = nowSeconds();
    const signature = await signStripePayload(BODY, timestamp);

    await expect(
      verifyStripeSignature(BODY, `t=${timestamp},v1=${signature.toUpperCase()}`, SECRET),
    ).resolves.toBeUndefined();
  });
});
