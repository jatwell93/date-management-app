import { Page, BrowserContext, expect } from '@playwright/test';
import path from 'path';
import { getOtpFromMailinator } from './mailinator';

export const MANAGER_EMAIL = 'testclerk2026b@mailinator.com';
export const MANAGER_PASSWORD = 'Xk9#mPqL2026$vN!';

export const AUTH_STATE_PATH = path.join(__dirname, '..', '.auth', 'manager.json');

/**
 * Creates a new test user via sign-up flow and returns the page for further use.
 */
export async function signUpAsManager(page: Page): Promise<void> {
  const testEmail = `e2e-manager-${Date.now()}@mailinator.com`;
  const testPassword = 'E2eTest#2026!Secure';

  await page.goto('/sign-up');

  // Fill sign-up form
  await page.getByLabel(/email/i).fill(testEmail);
  await page.locator('input[name="password"], input[id="password-field"]').fill(testPassword);
  await page.locator('button[data-localization-key="formButtonPrimary"]').click();

  // Wait for OTP verification screen - check for text instead of URL
  await expect(page.getByText(/verify|check your email|code/i)).toBeVisible({ timeout: 10000 });

  // Fetch OTP from Mailinator
  const otp = await getOtpFromMailinator(page, testEmail);

  // Enter OTP digit by digit
  const otpInputs = page.locator('input[inputmode="numeric"], input[type="text"][maxlength="1"]');
  const count = await otpInputs.count();

  if (count >= 6) {
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(otp[i]);
    }
  } else {
    await page.getByRole('textbox').last().fill(otp);
  }

  // Wait for redirect to onboarding after successful verification
  await page.waitForURL(/\/onboarding/, { timeout: 15000 });
}

/**
 * Signs in via the /login page and waits for the app to fully load.
 * Used in the global setup to persist auth state.
 */
export async function signInAsManager(page: Page): Promise<void> {
  await page.goto('/login');

  await page.getByLabel(/email|username/i).first().fill(MANAGER_EMAIL);
  await page.locator('input[name="password"], input[id="password-field"]').fill(MANAGER_PASSWORD);
  await page.locator('button[data-localization-key="formButtonPrimary"]').click();

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
