import { Page } from '@playwright/test';

const MAILINATOR_API = 'https://www.mailinator.com/api/v2';

/**
 * Fetches the latest OTP code from a Mailinator inbox.
 * Polls up to maxAttempts times with a 3-second delay between attempts.
 */
export async function getOtpFromMailinator(
  page: Page,
  email: string,
  maxAttempts = 10,
): Promise<string> {
  const inbox = email.split('@')[0];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await page.waitForTimeout(3000);

    const response = await page.request.get(
      `${MAILINATOR_API}/domains/mailinator.com/inboxes/${inbox}/messages`,
    );

    if (!response.ok()) continue;

    const data = await response.json();
    const messages: Array<{ id: string; subject: string }> = data.msgs ?? [];

    if (messages.length === 0) continue;

    const latest = messages[0];
    const msgResponse = await page.request.get(
      `${MAILINATOR_API}/domains/mailinator.com/inboxes/${inbox}/messages/${latest.id}`,
    );

    if (!msgResponse.ok()) continue;

    const msgData = await msgResponse.json();
    const body: string = msgData.parts?.[0]?.body ?? '';

    const match = body.match(/\b(\d{6})\b/);
    if (match) return match[1];
  }

  throw new Error(`OTP not found in Mailinator inbox for ${email} after ${maxAttempts} attempts`);
}
