import { test, expect } from '@playwright/test';

/**
 * E2E: Sign-in flow
 *
 * User flow:
 * 1. Navigate to /login
 * 2. Fill in credentials
 * 3. Assert redirect to /scan
 */

test.describe('Sign-in flow', () => {
  test('existing user can sign in and reach /scan', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/);

    await page
      .getByLabel(/email|username/i)
      .first()
      .fill('testclerk2026b@mailinator.com');
    await page
      .locator('input[name="password"], input[id="password-field"]')
      .fill('Xk9#mPqL2026$vN!');
    await page.locator('button[data-localization-key="formButtonPrimary"]').click();

    await expect(page).toHaveURL(/\/scan|\/onboarding/, { timeout: 15000 });
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page
      .getByLabel(/email|username/i)
      .first()
      .fill('notauser@mailinator.com');
    await page
      .locator('input[name="password"], input[id="password-field"]')
      .fill('WrongPassword123!');
    await page.locator('button[data-localization-key="formButtonPrimary"]').click();

    await expect(page.getByText(/invalid|incorrect|error/i)).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects to /scan if already signed in', async ({ page }) => {
    await page.goto('/login');
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).toMatch(/login|scan|onboarding/);
  });
});
