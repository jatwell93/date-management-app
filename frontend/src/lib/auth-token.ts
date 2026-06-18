import * as Sentry from '@sentry/react';

export type ClerkTokenGetter = () => Promise<string | null | undefined>;

interface ResolveApiTokenOptions {
  fallbackToken: string | null;
  getToken?: ClerkTokenGetter;
  actionTag: string;
}

export async function resolveApiToken({
  fallbackToken,
  getToken,
  actionTag,
}: ResolveApiTokenOptions): Promise<string | undefined> {
  if (!getToken) {
    return fallbackToken || undefined;
  }

  try {
    return (await getToken()) || fallbackToken || undefined;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { feature: 'auth-token', action: actionTag },
    });
    return fallbackToken || undefined;
  }
}
