import { test, expect } from '@playwright/test';

/**
 * E2E: Organisation settings page (role-based access)
 *
 * User flow:
 * 1. Manager can access /settings and see OrganizationProfile
 * 2. Team Member is redirected away from /settings to /scan
 * 3. Unauthenticated user is redirected to /login
 */

test.describe('Settings page - role-based access', () => {
  test('/settings redirects to /login when not signed in', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });

  test('Manager can access /settings and sees OrganizationProfile', async ({ page }) => {
    // Auth pre-loaded via storageState
    await page.goto('/settings');

    await expect(page).toHaveURL(/\/settings/, { timeout: 8000 });
    await expect(page.getByText(/organisation settings/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/organisation profile/i)).toBeVisible({ timeout: 8000 });
  });

  test('Settings nav link is visible for Manager', async ({ page }) => {
    // Auth pre-loaded via storageState
    await page.goto('/scan');

    // Settings link should be in the nav
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible({ timeout: 8000 });
  });
});
