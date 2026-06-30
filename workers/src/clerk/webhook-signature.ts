export interface ClerkWebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

const CLERK_WEBHOOK_MAX_SKEW_SECONDS = 5 * 60;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function decodeClerkWebhookSecret(secret: string): Uint8Array {
  const rawSecret = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const normalized = rawSecret.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return new TextEncoder().encode(rawSecret);
  }
}

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

function extractSvixV1Signatures(signatureHeader: string): string[] {
  const matches = signatureHeader.matchAll(/v1,([A-Za-z0-9+/=]+)/g);
  return Array.from(matches, (match) => match[1]);
}

export async function verifyClerkSvixSignature(
  rawBody: string,
  headers: ClerkWebhookHeaders,
  webhookSecret: string,
): Promise<void> {
  const timestampSeconds = Number.parseInt(headers.timestamp, 10);

  if (!Number.isFinite(timestampSeconds)) {
    throw new Error('Invalid svix-timestamp header');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > CLERK_WEBHOOK_MAX_SKEW_SECONDS) {
    throw new Error('Webhook timestamp outside allowed window');
  }

  const message = `${headers.id}.${headers.timestamp}.${rawBody}`;
  const secretBytes = decodeClerkWebhookSecret(webhookSecret);
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const expectedSignature = toBase64(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)),
  );

  const candidateSignatures = extractSvixV1Signatures(headers.signature);
  if (candidateSignatures.length === 0) {
    throw new Error('Invalid svix-signature header');
  }

  const isValid = candidateSignatures.some((signature) =>
    timingSafeEqual(signature, expectedSignature),
  );

  if (!isValid) {
    throw new Error('Invalid Clerk webhook signature');
  }
}
