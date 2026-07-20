import { useEffect, useState } from 'react';
import { apiService } from '../lib/api.service';
import { DEFAULT_MARKDOWN_MATRIX, type MarkdownMatrixConfig } from '@shared/markdown';
import { useFreshApiToken } from './useFreshApiToken';

interface MarkdownConfigResponse {
  matrix: MarkdownMatrixConfig;
  hasRetailData: boolean;
}

/**
 * Load the organization's markdown matrix (issue #338) so any pricing surface —
 * the scan page, worklist, and expiry table — reduces stock with the configured
 * bands and basis instead of the hardcoded 50/60/75%-off-cost ladder.
 *
 * Returns DEFAULT_MARKDOWN_MATRIX until the config resolves, and keeps it if the
 * fetch fails, so a config outage degrades to the previous behavior rather than
 * leaving items unpriced.
 */
export function useMarkdownMatrix(token: string | null): MarkdownMatrixConfig {
  const getFreshApiToken = useFreshApiToken(token);
  const [matrix, setMatrix] = useState<MarkdownMatrixConfig>(DEFAULT_MARKDOWN_MATRIX);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const apiToken = await getFreshApiToken('markdown-config-load');
        const config = await apiService.get<MarkdownConfigResponse>('/markdown-config', apiToken);
        if (!cancelled && config?.matrix) {
          setMatrix(config.matrix);
        }
      } catch {
        // Non-fatal: keep the default matrix.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getFreshApiToken]);

  return matrix;
}
