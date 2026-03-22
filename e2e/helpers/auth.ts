import { Page, BrowserContext, expect } from '@playwright/test';
import path from 'path';
import { getOtpFromMailinator } from './mailinator';

export const MANAGER_EMAIL = 'testclerk2026b@team403684.testinator.email';
export const MANAGER_PASSWORD = 'Xk9#mPqL2026$vN!';

export const AUTH_STATE_PATH = path.join(__dirname, '..', '.auth', 'manager.json');

async function enterOtpCode(page: Page, otp: string): Promise<void> {
  const otpInputs = page.locator('input[inputmode="numeric"], input[type="text"][maxlength="1"]');
  const count = await otpInputs.count();

  if (count >= 6) {
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(otp[i]);
    }
    return;
  }

  await page.getByRole('textbox').last().fill(otp);
}

/**
 * Creates a new test user via sign-up flow and returns the page for further use.
 */
export async function signUpAsManager(page: Page): Promise<void> {
  const testEmail = `e2e-manager-${Date.now()}@team403684.testinator.email`;
  const testUsername = `e2emanager${Date.now()}`;
  const testPassword = 'E2eTest#2026!Secure';

  await page.goto('/sign-up');

  // Fill sign-up form
  await page.getByRole('textbox', { name: /first name/i }).fill('E2E');
  await page.getByRole('textbox', { name: /last name/i }).fill('Manager');
  await page.getByRole('textbox', { name: /username/i }).fill(testUsername);
  await page.getByRole('textbox', { name: /email address/i }).fill(testEmail);
  await page.getByRole('textbox', { name: /password/i }).fill(testPassword);
  await page
    .getByRole('button', { name: /continue|sign up/i })
    .first()
    .click();

  // Clerk may either require email verification or redirect directly after sign-up.
  await page.waitForTimeout(1500);
  const postSubmitUrl = page.url();
  if (/\/(onboarding|scan)/.test(postSubmitUrl)) return;
  if (/\/verify-email-address/.test(postSubmitUrl)) {
    // Continue to OTP retrieval path below
  } else {
    const hasVerificationText = await page
      .getByText(/verify your email|verify|check your email|code|email verification/i)
      .isVisible({ timeout: 15000 })
      .catch(() => false);

    if (!hasVerificationText) {
      const bodyText = await page.locator('body').innerText();
      throw new Error(
        `Sign-up did not reach verification step. URL: ${page.url()} Body: ${bodyText.slice(0, 400)}`,
      );
    }
  }

  // Fetch OTP from Mailinator
  const otp = await getOtpFromMailinator(page, testEmail);

  // Enter OTP digit by digit
  await enterOtpCode(page, otp);

  // Wait for redirect to scan or onboarding after successful verification
  await page.waitForURL(/\/(scan|onboarding)/, { timeout: 15000 });
}

/**
 * Signs in via the /login page and waits for the app to fully load.
 * Used in the global setup to persist auth state.
 */
export async function signInAsManager(page: Page): Promise<void> {
  await page.goto('/login');

  await page
    .getByLabel(/email|username/i)
    .first()
    .fill(MANAGER_EMAIL);
  await page.locator('input[name="password"], input[id="password-field"]').fill(MANAGER_PASSWORD);
  await page.locator('button[data-localization-key="formButtonPrimary"]').click();

  // Clerk may require factor-two email verification on new devices
  await page.waitForTimeout(1200);
  if (/\/login\/factor-two/.test(page.url())) {
    const otp = await getOtpFromMailinator(page, MANAGER_EMAIL);
    await enterOtpCode(page, otp);
    await page
      .getByRole('button', { name: /continue/i })
      .first()
      .click();
  }

  // Wait until we land on /scan or /onboarding — auth is complete
  await page.waitForURL(/\/(scan|onboarding)/, { timeout: 20000 });
}

/**
 * Signs out by navigating to /login (Clerk clears session on logout button click).
 * Used to ensure a clean unauthenticated state.
 */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /logout/i }).click();
  await page.waitForURL(/\/login/, { timeout: 10000 });
}
