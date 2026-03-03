import { chromium, FullConfig } from '@playwright/test';
import { signInAsManager, signUpAsManager, AUTH_STATE_PATH } from './helpers/auth';
import fs from 'fs';
import path from 'path';

async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL ?? 'http://localhost:3002';

  // Ensure .auth directory exists
  const authDir = path.join(__dirname, '.auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();

  // Prefer existing manager sign-in to avoid OTP dependencies.
  // Fallback to sign-up if the account does not exist or sign-in fails.
  try {
    await signInAsManager(page);
  } catch {
    await signUpAsManager(page);
  }

  // Save signed-in storage state (cookies + localStorage)
  await context.storageState({ path: AUTH_STATE_PATH });

  await browser.close();
}

export default globalSetup;
