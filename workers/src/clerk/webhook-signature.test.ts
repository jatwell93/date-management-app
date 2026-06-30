import { describe, expect, it, vi } from 'vitest';
import { verifyClerkSvixSignature } from './webhook-signature';

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function signClerkWebhook(input: {
  secret: string;
  id: string;
  timestamp: string;
  rawBody: string;
}): Promise<string> {
  const rawSecret = input.secret.startsWith('whsec_')
    ? input.secret.slice('whsec_'.length)
    : input.secret;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(rawSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${input.id}.${input.timestamp}.${input.rawBody}`),
  );

  return `v1,${toBase64(signature)}`;
}

describe('verifyClerkSvixSignature', () => {
  it('accepts a valid signed Clerk webhook body', async () => {
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'));
    const rawBody = JSON.stringify({ type: 'user.created', data: { id: 'user_123' } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const id = 'msg_valid';
    const secret = 'local-test-secret';

    await expect(
      verifyClerkSvixSignature(
        rawBody,
        {
          id,
          timestamp,
          signature: await signClerkWebhook({ secret, id, timestamp, rawBody }),
        },
        secret,
      ),
    ).resolves.toBeUndefined();

    vi.useRealTimers();
  });

  it('rejects signatures outside the allowed timestamp window', async () => {
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'));
    const rawBody = JSON.stringify({ type: 'user.created', data: { id: 'user_123' } });
    const timestamp = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const id = 'msg_old';
    const secret = 'local-test-secret';

    await expect(
      verifyClerkSvixSignature(
        rawBody,
        {
          id,
          timestamp,
          signature: await signClerkWebhook({ secret, id, timestamp, rawBody }),
        },
        secret,
      ),
    ).rejects.toThrow('Webhook timestamp outside allowed window');

    vi.useRealTimers();
  });
});
