import { envConfig } from '../config/environment';

const CLERK_DEV_ORIGINS = ['http://localhost:3002', 'http://127.0.0.1:3002'];

export function getAuthorizedParties(): string[] {
  const partySet = new Set<string>(CLERK_DEV_ORIGINS);

  if (envConfig.FRONTEND_URL) {
    partySet.add(envConfig.FRONTEND_URL);
  }

  if (envConfig.CORS_ORIGIN) {
    partySet.add(envConfig.CORS_ORIGIN);
  }

  const parties = Array.from(partySet);
  if (parties.length === CLERK_DEV_ORIGINS.length && process.env.NODE_ENV === 'production') {
    console.warn(
      'WARNING: No production origins configured for Clerk token verification. Please set FRONTEND_URL or CORS_ORIGIN.',
    );
  }

  return parties;
}
