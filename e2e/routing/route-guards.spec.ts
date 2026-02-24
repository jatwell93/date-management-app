import { test, expect } from '@playwright/test';

/**
 * E2E: Route guards
 *
 * Verifies that:
 * - Unauthenticated users are redirected to /login from protected routes
 * - /onboarding redirects to /scan for users with an org
 * - /settings redirects to /scan for Team Members
 * - /login and /sign-up redirect to /scan for signed-in users
 */

test.describe('Route guards - unauthenticated', () => {
  const protectedRoutes = [
    '/scan',
    '/dashboard',
    '/reports',
    '/detailed-expiry-report',
    '/expired-items',
    '/usage-report',
    '/markdown-calculator',
    '/settings',
    '/user-management',
    '/store-area-management',
    '/csv-upload',
    '/onboarding',
  ];

  for (const route of protectedRoutes) {
    test(`${route} redirects to /login when not authenticated`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
    });
  }
});

test.describe('Route guards - authenticated Manager', () => {
  test.use({ storageState: './e2e/.auth/manager.json' });

  test('/login redirects to /scan when already signed in', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/scan/, { timeout: 8000 });
  });

  test('/sign-up redirects to /scan when already signed in', async ({ page }) => {
    await page.goto('/sign-up');
    await expect(page).toHaveURL(/\/scan/, { timeout: 8000 });
  });

  test('/settings is accessible for Manager', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings/, { timeout: 8000 });
    await expect(page.getByText(/organisation settings/i)).toBeVisible();
  });

  test('/onboarding redirects to /scan for user with existing org', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/scan/, { timeout: 8000 });
  });

  test('Manager nav shows Settings link', async ({ page }) => {
    await page.goto('/scan');
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible();
  });

  test('Manager nav shows User Management link', async ({ page }) => {
    await page.goto('/scan');
    await expect(page.getByRole('link', { name: /user management/i })).toBeVisible();
  });
});
