import { useCallback, useEffect, useState } from 'react';
import { apiService } from '../lib/api.service';
import {
  DEFAULT_MARKDOWN_MATRIX,
  type MarkdownMatrixConfig,
  type MarkdownMatrixSet,
} from '@shared/markdown';
import { useFreshApiToken } from './useFreshApiToken';

interface MarkdownConfigResponse {
  matrices: MarkdownMatrixSet;
  matrix: MarkdownMatrixConfig;
  hasRetailData: boolean;
}

export type MarkdownMatricesStatus = 'loading' | 'ready' | 'error';

export interface MarkdownMatricesState {
  matrices: MarkdownMatrixSet | null;
  status: MarkdownMatricesStatus;
  error: string | null;
  retry: () => void;
}

interface MarkdownMatricesLoadState extends Omit<MarkdownMatricesState, 'retry'> {
  requestVersion: number;
  token: string | null;
}

/**
 * Load the organization's markdown matrix (issue #338) so any pricing surface —
 * the scan page, worklist, and expiry table — reduces stock with the configured
 * bands and basis instead of the hardcoded 50/60/75%-off-cost ladder.
 *
 * Keeps matrices unavailable until the organization config resolves. A failed
 * request remains unpriced and exposes retry state so printable prices can never
 * silently fall back to defaults during an outage.
 */
export function useMarkdownMatrices(token: string | null): MarkdownMatricesState {
  const getFreshApiToken = useFreshApiToken(token);
  const [requestVersion, setRequestVersion] = useState(0);
  const [loadState, setLoadState] = useState<MarkdownMatricesLoadState>({
    matrices: null,
    status: 'loading',
    error: null,
    requestVersion: 0,
    token,
  });

  const retry = useCallback(() => setRequestVersion((version) => version + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apiToken = await getFreshApiToken('markdown-config-load');
        const config = await apiService.get<MarkdownConfigResponse>('/markdown-config', apiToken);
        if (!cancelled) {
          setLoadState({
            matrices: config.matrices,
            status: 'ready',
            error: null,
            requestVersion,
            token,
          });
        }
      } catch {
        if (!cancelled) {
          setLoadState({
            matrices: null,
            status: 'error',
            error: 'We could not load markdown pricing. Try again before printing a price.',
            requestVersion,
            token,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getFreshApiToken, requestVersion, token]);

  const isCurrentRequest = loadState.requestVersion === requestVersion && loadState.token === token;
  return isCurrentRequest
    ? { matrices: loadState.matrices, status: loadState.status, error: loadState.error, retry }
    : { matrices: null, status: 'loading', error: null, retry };
}

/** @deprecated Use useMarkdownMatrices so pricing waits for organization config readiness. */
export function useMarkdownMatrix(token: string | null): MarkdownMatrixConfig {
  const { matrices } = useMarkdownMatrices(token);
  return matrices?.NO_CREDIT ?? DEFAULT_MARKDOWN_MATRIX;
}
