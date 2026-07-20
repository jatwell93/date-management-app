import { envConfig } from '../config/environment';
import { Logger } from '../utils/logger';

/**
 * Minimal transactional-email seam. The claim sender depends on this interface,
 * not on a concrete provider, so the provider stays swappable and unit tests can
 * inject a fake (design.md decision 3). Distinct from the SendGrid-based
 * `email.service.ts`, which handles billing/trial notifications and is untouched.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export interface EmailSender {
  /** Returns true when the message was accepted by the provider. */
  send(message: EmailMessage): Promise<boolean>;
}

/**
 * Resend implementation via the plain REST API (https://resend.com/docs) — no SDK
 * dependency, uses global fetch (Node 20+). Chosen over SendGrid for its Workers-
 * friendly footprint and cost profile. Degrades to a warn+no-op when unconfigured,
 * mirroring how `email.service.ts` behaves without a SendGrid key.
 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private apiKey: string | undefined = envConfig.RESEND_API_KEY,
    private fromEmail: string = envConfig.RESEND_FROM_EMAIL || 'noreply@example.com',
  ) {}

  async send(message: EmailMessage): Promise<boolean> {
    if (!this.apiKey) {
      Logger.warn('RESEND_API_KEY not set. Credit-claim email not sent.', { to: message.to });
      return false;
    }

    const body: Record<string, unknown> = {
      from: this.fromEmail,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    };
    if (message.attachments?.length) {
      body.attachments = message.attachments.map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64'),
        content_type: a.contentType,
      }));
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Resend send failed (${response.status}): ${detail}`);
    }
    return true;
  }
}

/** Test/dev fallback that records nothing and always "sends". */
export class NoopEmailSender implements EmailSender {
  async send(): Promise<boolean> {
    return true;
  }
}
