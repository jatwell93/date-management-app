import { Page } from '@playwright/test';

const MAILINATOR_API = 'https://api.mailinator.com/api/v2';

/**
 * Fetches the latest OTP code from a Mailinator inbox.
 * Polls up to maxAttempts times with a 3-second delay between attempts.
 */
export async function getOtpFromMailinator(
  page: Page,
  email: string,
  maxAttempts = 40,
): Promise<string> {
  const [inbox] = email.split('@');
  const apiToken = process.env.MAILINATOR_API_TOKEN;

  // Validate API token before making requests
  if (!apiToken) {
    throw new Error(
      'MAILINATOR_API_TOKEN environment variable is required for OTP retrieval. Set this in your .env file or environment variables.',
    );
  }

  function extractOtp(text: string | undefined): string | null {
    if (!text) return null;
    const match = text.match(/\b(\d{6})\b/);
    return match ? match[1] : null;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await page.waitForTimeout(3000);

    const response = await page.request.get(
      `${MAILINATOR_API}/domains/private/inboxes?token=${apiToken}`,
    );

    if (response.status() === 401) {
      throw new Error(
        'Mailinator API returned 401 Unauthorized. Set MAILINATOR_API_TOKEN to allow OTP retrieval for E2E auth setup.',
      );
    }

    if (!response.ok()) {
      console.log(
        `[Mailinator] Attempt ${attempt + 1}/${maxAttempts}: API returned ${response.status()}`,
      );
      continue;
    }

    const data = await response.json();
    const allMessages: Array<{ id: string; subject?: string; to?: string }> = data.msgs ?? [];

    // Filter messages for this specific inbox
    const messages = allMessages.filter((msg) => msg.to === inbox);
    console.log(
      `[Mailinator] Attempt ${attempt + 1}/${maxAttempts}: Found ${messages.length} messages for ${inbox}`,
    );

    if (messages.length === 0) continue;

    // Check up to 5 newest messages - OTP is in subject line
    const recentMessages = messages.slice(0, 5);
    for (const message of recentMessages) {
      const otpFromSubject = extractOtp(message.subject);
      if (otpFromSubject) {
        console.log(`[Mailinator] Found OTP ${otpFromSubject} in subject: ${message.subject}`);
        return otpFromSubject;
      }
    }
  }

  throw new Error(`OTP not found in Mailinator inbox for ${email} after ${maxAttempts} attempts`);
}
