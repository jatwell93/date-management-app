import { useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { resolveApiToken } from '../lib/auth-token';

export function useFreshApiToken(fallbackToken: string | null) {
  const { getToken } = useAuth();

  return useCallback(
    (actionTag: string) =>
      resolveApiToken({
        fallbackToken,
        getToken,
        actionTag,
      }),
    [fallbackToken, getToken],
  );
}
