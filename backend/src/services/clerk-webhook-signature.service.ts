import { Webhook } from 'svix';

type ClerkWebhookVerifier = {
  verify: (payload: string, headers: Record<string, string>) => unknown;
};

export class ClerkWebhookSignatureService {
  private webhookSecret?: string;
  private createWebhook: (secret: string) => ClerkWebhookVerifier;

  constructor(webhookSecret?: string, createWebhook?: (secret: string) => ClerkWebhookVerifier) {
    this.webhookSecret = webhookSecret;
    this.createWebhook = createWebhook ?? ((secret: string) => new Webhook(secret));
  }

  verifySignature(payload: Buffer, headers: Record<string, string>): unknown {
    if (!this.webhookSecret) {
      throw new Error('CLERK_WEBHOOK_SECRET is not configured');
    }

    const svixId = headers['svix-id'];
    const svixTimestamp = headers['svix-timestamp'];
    const svixSignature = headers['svix-signature'];

    if (!svixId || !svixTimestamp || !svixSignature) {
      throw new Error('Missing required Svix headers');
    }

    const wh = this.createWebhook(this.webhookSecret);
    return wh.verify(payload.toString(), {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    });
  }
}
