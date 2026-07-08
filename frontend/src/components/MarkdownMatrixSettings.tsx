import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_MARKDOWN_MATRIX,
  type MarkdownBasis,
  type MarkdownMatrixConfig,
} from '@shared/markdown';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { apiService } from '../lib/api.service';
import { useFreshApiToken } from '../hooks/useFreshApiToken';

interface MarkdownConfigResponse {
  matrix: MarkdownMatrixConfig;
  hasRetailData: boolean;
}

type BandKey = 'band1' | 'band2' | 'band3';

const BANDS: Array<{ key: BandKey; title: string; window: string }> = [
  { key: 'band1', title: 'Markdown 1', window: '61–90 days to expiry' },
  { key: 'band2', title: 'Markdown 2', window: '31–60 days to expiry' },
  { key: 'band3', title: 'Markdown 3', window: '0–30 days to expiry' },
];

function isNonDecreasing(matrix: MarkdownMatrixConfig): boolean {
  return (
    matrix.band1.percentage <= matrix.band2.percentage &&
    matrix.band2.percentage <= matrix.band3.percentage
  );
}

export function MarkdownMatrixSettings() {
  const getFreshApiToken = useFreshApiToken(null);
  const [matrix, setMatrix] = useState<MarkdownMatrixConfig>(DEFAULT_MARKDOWN_MATRIX);
  const [hasRetailData, setHasRetailData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getFreshApiToken('markdown-config-load');
        const config = await apiService.get<MarkdownConfigResponse>('/markdown-config', token);
        if (!cancelled) {
          setMatrix(config.matrix);
          setHasRetailData(config.hasRetailData);
        }
      } catch {
        if (!cancelled) {
          setError('We could not load your markdown settings. Reload and try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getFreshApiToken]);

  const updateBand = useCallback(
    (key: BandKey, patch: Partial<{ percentage: number; basis: MarkdownBasis }>) => {
      setSuccess(null);
      setMatrix((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
    },
    [],
  );

  const monotonic = useMemo(() => isNonDecreasing(matrix), [matrix]);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    if (!monotonic) {
      setError(
        'Discounts must not decrease as expiry nears: Markdown 1 ≤ Markdown 2 ≤ Markdown 3.',
      );
      return;
    }

    setSaving(true);
    try {
      const token = await getFreshApiToken('markdown-config-save');
      const config = await apiService.put<MarkdownConfigResponse>(
        '/markdown-config',
        matrix,
        token,
      );
      setMatrix(config.matrix);
      setHasRetailData(config.hasRetailData);
      setSuccess('Markdown matrix saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not save your markdown settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Markdown matrix</CardTitle>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Set the discount for each markdown band and whether it comes off cost or retail price.
          {!hasRetailData &&
            ' Upload a catalogue with a retail (or selling price) column to enable retail-based markdowns.'}
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading markdown settings…</p>
        ) : (
          <div className="space-y-4">
            {BANDS.map(({ key, title, window }) => (
              <div
                key={key}
                className="grid gap-3 rounded-md border bg-semantic-surface-2 p-4 sm:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <h3 className="font-heading text-base font-semibold">{title}</h3>
                  <p className="text-sm text-muted-foreground">{window}</p>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1">
                    <Label htmlFor={`${key}-percentage`}>Discount %</Label>
                    <Input
                      id={`${key}-percentage`}
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      className="min-h-11 w-28"
                      value={String(matrix[key].percentage)}
                      onChange={(e) => updateBand(key, { percentage: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="block text-sm font-medium">Basis</span>
                    <div
                      className="inline-flex rounded-md border"
                      role="group"
                      aria-label={`${title} basis`}
                    >
                      <button
                        type="button"
                        aria-pressed={matrix[key].basis === 'cost'}
                        onClick={() => updateBand(key, { basis: 'cost' })}
                        className={`min-h-11 px-4 text-sm font-medium ${
                          matrix[key].basis === 'cost'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-transparent'
                        }`}
                      >
                        Cost
                      </button>
                      <button
                        type="button"
                        aria-pressed={matrix[key].basis === 'retail'}
                        disabled={!hasRetailData}
                        title={
                          hasRetailData
                            ? undefined
                            : 'Upload retail prices to enable retail-based markdowns'
                        }
                        onClick={() => updateBand(key, { basis: 'retail' })}
                        className={`min-h-11 px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                          matrix[key].basis === 'retail'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-transparent'
                        }`}
                      >
                        Retail
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {!monotonic && (
              <p role="alert" className="text-sm text-semantic-critical">
                Discounts should not decrease as expiry nears: Markdown 1 ≤ Markdown 2 ≤ Markdown 3.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-semantic-critical">
                {error}
              </p>
            )}
            {success && (
              <p role="status" className="text-sm text-semantic-success">
                {success}
              </p>
            )}

            <Button
              type="button"
              size="lg"
              className="min-h-11"
              onClick={handleSave}
              disabled={saving || !monotonic}
            >
              {saving ? 'Saving…' : 'Save markdown matrix'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
