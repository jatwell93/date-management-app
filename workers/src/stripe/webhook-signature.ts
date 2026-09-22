/**
 * Stripe webhook signature verification, implemented against Web Crypto.
 *
 * **Why not the Stripe SDK.** `stripe.webhooks.constructEvent` is synchronous
 * and reaches for Node's `crypto.createHmac`, which does not exist in workerd;
 * the async `constructEventAsync` does work, but pulling the SDK in to use one
 * function of it would add a large dependency to a bundle that has a size gate,
 * for a scheme that is forty lines. The Clerk webhook set this precedent in
 * `../clerk/webhook-signature.ts` and this module deliberately mirrors its
 * shape so the two read alike.
 *
 * **It is not, however, a copy of it**, and the differences are the whole
 * substance of the file:
 *
 * - Svix signs `${id}.${timestamp}.${body}`; Stripe signs `${timestamp}.${body}`
 *   and has no id in the signed payload.
 * - Svix base64-decodes the secret after stripping `whsec_`; Stripe uses the
 *   endpoint secret as a literal UTF-8 string, `whsec_` prefix included. This is
 *   the one that silently breaks: decoding a Stripe secret produces a verifier
 *   that rejects every genuine delivery and accepts nothing, which looks exactly
 *   like a misconfigured secret.
 * - Svix encodes the digest as base64; Stripe encodes it as lowercase hex.
 *
 * The signature header carries a timestamp and one or more scheme-tagged
 * signatures, e.g. `t=1492774577,v1=5257a869...,v1=<second during key rotation>`.
 * Every `v1` is checked: Stripe sends two during an endpoint-secret roll, and
 * accepting only the first would drop half the deliveries for the duration.
 * Schemes other than `v1` are ignored rather than rejected — `v0` exists and is
 * used for other products, and a future scheme must not make this throw.
 */

/** Stripe's own default tolerance for replay. */
const STRIPE_WEBHOOK_MAX_SKEW_SECONDS = 5 * 60;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison.
 *
 * Length is compared first and returns early, which does leak the length of the
 * expected digest — that is a fixed 64 characters for SHA-256 hex and therefore
 * not a secret. The loop itself runs over every character regardless of where a
 * mismatch occurs.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;

  for (let idx = 0; idx < a.length; idx += 1) {
    mismatch |= a.charCodeAt(idx) ^ b.charCodeAt(idx);
  }

  return mismatch === 0;
}

export interface ParsedStripeSignatureHeader {
  timestamp: number;
  v1Signatures: string[];
}

/**
 * Split `t=...,v1=...,v1=...` into its parts.
 *
 * Returns `null` for anything unparseable rather than throwing, so the caller
 * reports one signature failure shape for every malformed header.
 */
export function parseStripeSignatureHeader(header: string): ParsedStripeSignatureHeader | null {
  let timestamp: number | null = null;
  const v1Signatures: string[] = [];

  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === 't') {
      const parsed = Number.parseInt(value, 10);
      // `Number.parseInt` stops at the first non-digit, so `t=12abc` would give
      // 12 rather than NaN. Insist the value is digits and nothing else.
      if (/^\d+$/.test(value) && Number.isFinite(parsed)) {
        timestamp = parsed;
      }
    } else if (key === 'v1' && /^[a-f0-9]+$/i.test(value)) {
      v1Signatures.push(value.toLowerCase());
    }
  }

  if (timestamp === null || v1Signatures.length === 0) {
    return null;
  }

  return { timestamp, v1Signatures };
}

/**
 * Verify a Stripe webhook signature, throwing on any failure.
 *
 * Throws rather than returning a boolean so that no caller can treat the result
 * as truthy by accident; the Clerk handler makes the same choice.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
  maxSkewSeconds: number = STRIPE_WEBHOOK_MAX_SKEW_SECONDS,
): Promise<void> {
  const parsed = parseStripeSignatureHeader(signatureHeader);

  if (!parsed) {
    throw new Error('Invalid stripe-signature header');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > maxSkewSeconds) {
    throw new Error('Webhook timestamp outside allowed window');
  }

  // The secret is used verbatim — see the file header. Whitespace is trimmed by
  // the caller; nothing else is stripped.
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signedPayload = `${parsed.timestamp}.${rawBody}`;
  const expectedSignature = toHex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload)),
  );

  // Every candidate is compared, and the comparison is not short-circuited on
  // the first match, because Stripe sends one `v1` per active endpoint secret
  // during a key rotation.
  const isValid = parsed.v1Signatures.some((signature) =>
    timingSafeEqual(signature, expectedSignature),
  );

  if (!isValid) {
    throw new Error('Invalid Stripe webhook signature');
  }
}
