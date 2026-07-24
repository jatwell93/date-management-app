import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CreditScope,
  MarkdownBasis,
  MarkdownMatrixConfig,
  MarkdownMatrixSet,
} from '@shared/markdown';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { apiService } from '../lib/api.service';
import { useFreshApiToken } from '../hooks/useFreshApiToken';

interface MarkdownConfigResponse {
  matrices: MarkdownMatrixSet;
  matrix: MarkdownMatrixConfig;
  hasRetailData: boolean;
}

type BandKey = 'band1' | 'band2' | 'band3';

const BANDS: Array<{ key: BandKey; title: string; window: string }> = [
  { key: 'band1', title: 'Markdown 1', window: '61–90 days to expiry' },
  { key: 'band2', title: 'Markdown 2', window: '31–60 days to expiry' },
  { key: 'band3', title: 'Markdown 3', window: '0–30 days to expiry' },
];

const SCOPE_LABELS: Record<CreditScope, string> = {
  NO_CREDIT: 'No supplier credit',
  FULL_CREDIT: 'Full supplier credit',
};

function isValidMatrix(matrix: MarkdownMatrixConfig): boolean {
  const values = BANDS.map(({ key }) => matrix[key].percentage);
  return (
    values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100) &&
    values[0] <= values[1] &&
    values[1] <= values[2]
  );
}

interface MatrixEditorProps {
  scope: CreditScope;
  matrix: MarkdownMatrixConfig;
  hasRetailData: boolean;
  onChange: (matrix: MarkdownMatrixConfig) => void;
}

export function MarkdownMatrixEditor({
  scope,
  matrix,
  hasRetailData,
  onChange,
}: MatrixEditorProps) {
  const scopeLabel = SCOPE_LABELS[scope];
  const updateBand = useCallback(
    (key: BandKey, patch: Partial<{ percentage: number; basis: MarkdownBasis }>) => {
      onChange({ ...matrix, [key]: { ...matrix[key], ...patch } });
    },
    [matrix, onChange],
  );

  return (
    <section aria-labelledby={`${scope}-heading`} className="space-y-3 rounded-lg border p-4">
      <div>
        <h3 id={`${scope}-heading`} className="font-heading text-lg font-semibold">
          {scopeLabel}
        </h3>
        <p className="text-sm text-muted-foreground">
          {scope === 'FULL_CREDIT'
            ? 'Pricing for stock eligible for full supplier credit.'
            : 'Pricing for stock without confirmed full supplier credit.'}
        </p>
      </div>
      {BANDS.map(({ key, title, window }) => (
        <div
          key={key}
          className="grid gap-3 rounded-md bg-semantic-surface-2 p-4 sm:grid-cols-[1fr_auto]"
        >
          <div className="min-w-0">
            <h4 className="font-heading text-base font-semibold">{title}</h4>
            <p className="text-sm text-muted-foreground">{window}</p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor={`${scope}-${key}-percentage`}>
                {scopeLabel} {title} discount %
              </Label>
              <Input
                id={`${scope}-${key}-percentage`}
                type="number"
                min="0"
                max="100"
                step="1"
                className="min-h-11 w-28"
                value={String(matrix[key].percentage)}
                onChange={(event) => updateBand(key, { percentage: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <span className="block text-sm font-medium">Basis</span>
              <div
                className="inline-flex rounded-md border"
                role="group"
                aria-label={`${scopeLabel} ${title} basis`}
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
      {!isValidMatrix(matrix) && (
        <p role="alert" className="text-sm text-semantic-critical">
          {scopeLabel} discounts must be between 0 and 100 and must not decrease as expiry nears.
        </p>
      )}
    </section>
  );
}

export function MarkdownMatrixSettings() {
  const getFreshApiToken = useFreshApiToken(null);
  const [matrices, setMatrices] = useState<MarkdownMatrixSet | null>(null);
  const [originalMatrices, setOriginalMatrices] = useState<MarkdownMatrixSet | null>(null);
  const [hasRetailData, setHasRetailData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getFreshApiToken('markdown-config-load');
        const config = await apiService.get<MarkdownConfigResponse>('/markdown-config', token);
        if (!cancelled) {
          setMatrices(config.matrices);
          setOriginalMatrices(config.matrices);
          setHasRetailData(config.hasRetailData);
        }
      } catch {
        if (!cancelled) setError('We could not load your markdown settings. Reload and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getFreshApiToken]);

  const valid = useMemo(
    () => matrices != null && Object.values(matrices).every(isValidMatrix),
    [matrices],
  );
  const dirty = useMemo(
    () =>
      matrices != null &&
      originalMatrices != null &&
      JSON.stringify(matrices) !== JSON.stringify(originalMatrices),
    [matrices, originalMatrices],
  );

  const updateMatrix = useCallback((scope: CreditScope, matrix: MarkdownMatrixConfig) => {
    setSuccess(null);
    setMatrices((current) => (current ? { ...current, [scope]: matrix } : current));
  }, []);

  const handleSave = async () => {
    if (!matrices || !valid || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const token = await getFreshApiToken('markdown-config-save');
      const config = await apiService.put<MarkdownConfigResponse>(
        '/markdown-config',
        { matrices },
        token,
      );
      setMatrices(config.matrices);
      setOriginalMatrices(config.matrices);
      setHasRetailData(config.hasRetailData);
      setSuccess('Markdown matrices saved.');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'We could not save your markdown settings.',
      );
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Markdown matrices</CardTitle>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Set separate discounts for stock with and without confirmed full supplier credit.
          {!hasRetailData &&
            ' Upload a catalogue with a retail (or selling price) column to enable retail-based markdowns.'}
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading markdown settings…</p>
        ) : matrices ? (
          <div className="space-y-4">
            <MarkdownMatrixEditor
              scope="NO_CREDIT"
              matrix={matrices.NO_CREDIT}
              hasRetailData={hasRetailData}
              onChange={(matrix) => updateMatrix('NO_CREDIT', matrix)}
            />
            <MarkdownMatrixEditor
              scope="FULL_CREDIT"
              matrix={matrices.FULL_CREDIT}
              hasRetailData={hasRetailData}
              onChange={(matrix) => updateMatrix('FULL_CREDIT', matrix)}
            />
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
              onClick={() => setConfirming(true)}
              disabled={saving || !valid || !dirty}
            >
              {saving ? 'Saving…' : 'Save markdown matrices'}
            </Button>
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Save markdown matrices?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Eligible stock is repriced immediately. Existing shelf labels may need to be
                    re-stickered.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleSave()} disabled={saving}>
                    Save and reprice
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : error ? (
          <p role="alert" className="text-sm text-semantic-critical">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
