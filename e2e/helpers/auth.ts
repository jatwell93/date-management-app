import { Page, BrowserContext } from '@playwright/test';
import path from 'path';

export const MANAGER_EMAIL = 'testclerk2026b@mailinator.com';
export const MANAGER_PASSWORD = 'Xk9#mPqL2026$vN!';

export const AUTH_STATE_PATH = path.join(__dirname, '..', '.auth', 'manager.json');

/**
 * Signs in via the /login page and waits for the app to fully load.
 * Used in the global setup to persist auth state.
 */
export async function signInAsManager(page: Page): Promise<void> {
  await page.goto('/login');

  await page.getByLabel(/email|username/i).first().fill(MANAGER_EMAIL);
  await page.getByLabel(/password/i).fill(MANAGER_PASSWORD);
  await page.getByRole('button', { name: /continue|sign in/i }).click();

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
