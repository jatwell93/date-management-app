import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { apiService } from '../lib/api.service';
import { calendarDaysUntil } from '../lib/utils';
import { calculateMarkdownPrice } from '@shared/markdown';
import Toast from '../components/ui/toast';
import { useFreshApiToken } from '../hooks/useFreshApiToken';
import { useMarkdownMatrices } from '../hooks/useMarkdownMatrix';
import type { MarkdownCreditContext } from '@shared/markdown-credit-context';
import { MarkdownCreditScopeBadge } from '../components/MarkdownCreditScopeBadge';
import { MarkdownMatricesNotice } from '../components/MarkdownMatricesNotice';

interface DetailedExpiryReportPageProps {
  token: string | null;
}

interface DetailedExpiryReportItem extends MarkdownCreditContext {
  inventoryId: number;
  expiryDate: string; // Format: YYYY-MM-DD
  status: string;
  productId: number;
  productName: string;
  sku: string;
  costPrice: number;
  retailPrice: number | null;
  locationId: number;
  locationName: string;
  subDepartment: string | null;
}

interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  visible: boolean;
}

const numberFormatter = new Intl.NumberFormat('en-AU');
const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});

function formatCurrencyValue(value: number): string {
  return Number.isFinite(value) ? currencyFormatter.format(value) : 'Not available';
}

function getDaysToExpiry(expiryDate: string) {
  const days = calendarDaysUntil(expiryDate);
  return Number.isNaN(days) ? null : days;
}

// The expired tile mirrors the Expired items worklist exactly. A failure here must
// not block the markdown report, so it resolves to null ("count unavailable").
async function fetchExpiredItemCount(
  authToken: string | undefined,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const items = await apiService.get<unknown[]>('/expired-items', authToken, signal);
    return Array.isArray(items) ? items.length : null;
  } catch {
    return null;
  }
}

function ExpiredCountValue({ count }: { count: number | null }) {
  if (count === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">Count unavailable</span>
      </>
    );
  }
  return <>{numberFormatter.format(count)}</>;
}

function formatDaysLeft(daysToExpiry: number | null): string {
  if (daysToExpiry === null) return 'Expiry date unknown';
  if (daysToExpiry === 0) return 'Expires today';
  return `${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'} left`;
}

type WorklistGroupKey = 'markdown1' | 'markdown2' | 'markdown3';

// The monthly markdown worklist mirrors the in-store process: items entering the
// Markdown 1 window get their first reduction, then nearer-dated stock is deepened
// or recorded as sold through. Write-offs happen on the Expired items page.
const WORKLIST_GROUPS: ReadonlyArray<{
  key: WorklistGroupKey;
  label: string;
  hint: string;
}> = [
  { key: 'markdown1', label: 'Apply Markdown 1', hint: '61–90 days to expiry — first reduction' },
  {
    key: 'markdown2',
    label: 'Markdown 2 — review',
    hint: '31–60 days — deepen the reduction or record sold through',
  },
  {
    key: 'markdown3',
    label: 'Markdown 3 — urgent',
    hint: '0–30 days — record sold through before it expires',
  },
];

function worklistGroupForDays(daysToExpiry: number | null): WorklistGroupKey | null {
  if (daysToExpiry === null || daysToExpiry < 0) return null;
  if (daysToExpiry <= 30) return 'markdown3';
  if (daysToExpiry <= 60) return 'markdown2';
  if (daysToExpiry <= 90) return 'markdown1';
  return null;
}

export function DetailedExpiryReportPage({ token }: DetailedExpiryReportPageProps) {
  const getFreshApiToken = useFreshApiToken(token);
  const markdownConfig = useMarkdownMatrices(token);
  const [reportData, setReportData] = useState<DetailedExpiryReportItem[] | null>(null);
  const [expiredCount, setExpiredCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [soldThroughId, setSoldThroughId] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState>({ message: '', type: 'success', visible: false });

  const showToast = useCallback((message: string, type: ToastState['type']) => {
    setToast({ message, type, visible: true });
  }, []);

  const fetchReportData = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) {
        setFetchError('Authentication token is missing.');
        setLoading(false);
        return;
      }
      try {
        const authToken = await getFreshApiToken('detailed-expiry-report-fetch');
        const [data, expiredItems] = await Promise.all([
          apiService.get<DetailedExpiryReportItem[]>('/reports/expiry-details', authToken, signal),
          fetchExpiredItemCount(authToken, signal),
        ]);
        if (!signal?.aborted) {
          setReportData(data);
          setExpiredCount(expiredItems);
          setFetchError(null);
        }
      } catch (err: unknown) {
        if (!signal?.aborted) {
          setFetchError(
            err instanceof Error ? err.message : 'Failed to load expiry report. Please try again.',
          );
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [token, getFreshApiToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sets loading before kicking off an abortable fetch
    setLoading(true);
    fetchReportData(controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchReportData]);

  const handleSoldThrough = useCallback(
    async (inventoryId: number) => {
      if (!token) {
        setActionError('Authentication token is missing.');
        return;
      }
      setSoldThroughId(inventoryId);
      setActionError(null);
      try {
        const authToken = await getFreshApiToken('detailed-expiry-sold-through');
        // Reuse the existing disposition endpoint; the markdown level at sale is
        // snapshotted server-side from the item's expiry date.
        await apiService.post(
          '/expired-items/process',
          { inventoryItemId: inventoryId, action: 'sold_through' },
          authToken,
        );
        const updatedData = await apiService.get<DetailedExpiryReportItem[]>(
          '/reports/expiry-details',
          authToken,
        );
        setReportData(updatedData);
        showToast('Item recorded as sold through.', 'success');
      } catch (err: unknown) {
        setActionError(
          err instanceof Error ? err.message : 'Failed to record sold through. Please try again.',
        );
      } finally {
        setSoldThroughId(null);
      }
    },
    [token, getFreshApiToken, showToast],
  );

  const retryControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      retryControllerRef.current?.abort();
    };
  }, []);

  const handleRetryFetch = useCallback(() => {
    retryControllerRef.current?.abort();
    const controller = new AbortController();
    retryControllerRef.current = controller;
    setFetchError(null);
    setLoading(true);
    fetchReportData(controller.signal);
  }, [fetchReportData]);

  const worklistGroups = useMemo(() => {
    const groups: Record<WorklistGroupKey, DetailedExpiryReportItem[]> = {
      markdown1: [],
      markdown2: [],
      markdown3: [],
    };
    for (const item of reportData || []) {
      const group = worklistGroupForDays(getDaysToExpiry(item.expiryDate));
      if (group) {
        groups[group].push(item);
      }
    }
    return groups;
  }, [reportData]);

  const expirySummary = useMemo(
    () =>
      (reportData || []).reduce(
        (summary, item) => {
          // The report only returns stock expiring today or later, so 0-day items
          // stay Markdown 3 work. Past-expiry stock is counted from /expired-items.
          const daysToExpiry = getDaysToExpiry(item.expiryDate);
          if (daysToExpiry !== null && daysToExpiry <= 90) {
            summary.markdown += 1;
          } else {
            summary.active += 1;
          }
          return summary;
        },
        { markdown: 0, active: 0 },
      ),
    [reportData],
  );

  if (loading) {
    return (
      <section
        className="container mx-auto max-w-7xl space-y-6 p-4"
        aria-label="Detailed expiry reporting workspace"
      >
        <header className="mb-5">
          <div
            className="h-7 w-full max-w-72 motion-safe:animate-pulse rounded bg-semantic-surface-4"
            aria-hidden="true"
          />
          <div
            className="mt-2 h-4 w-full max-w-96 motion-safe:animate-pulse rounded bg-semantic-surface-4"
            aria-hidden="true"
          />
        </header>
        <div
          className="h-32 motion-safe:animate-pulse rounded-lg bg-semantic-surface-3"
          aria-hidden="true"
        />
        <Card className="overflow-hidden">
          <CardHeader>
            <div
              className="h-6 w-36 motion-safe:animate-pulse rounded bg-semantic-surface-4"
              aria-hidden="true"
            />
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <div
              className="h-16 motion-safe:animate-pulse rounded bg-semantic-surface-4"
              aria-hidden="true"
            />
            <div
              className="h-16 motion-safe:animate-pulse rounded bg-semantic-surface-4"
              aria-hidden="true"
            />
          </CardContent>
        </Card>
        <p className="sr-only" role="status" aria-live="polite">
          Loading detailed expiry report…
        </p>
      </section>
    );
  }

  if (fetchError) {
    return (
      <section
        className="container mx-auto max-w-7xl p-4"
        aria-label="Detailed expiry reporting workspace"
      >
        <div
          role="alert"
          className="rounded-lg border border-semantic-critical-muted bg-semantic-critical-muted p-6 text-center"
        >
          <p className="font-medium text-semantic-critical-muted-foreground">{fetchError}</p>
          <Button onClick={handleRetryFetch} variant="default" className="mt-4 min-h-11">
            Try again
          </Button>
        </div>
      </section>
    );
  }

  const hasData = reportData && reportData.length > 0;

  return (
    <section
      className="container mx-auto max-w-7xl space-y-6 p-4"
      aria-label="Detailed expiry reporting workspace"
    >
      <header className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-2xl font-semibold">Markdown Worklist (Next 90 Days)</h1>
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/expiry-entries">Browse all expiry entries</Link>
          </Button>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-semantic-text-secondary">
          This month&apos;s markdown decisions, grouped by days to expiry. To find or fix any active
          entry, open the full expiry entries table.
        </p>
      </header>
      <MarkdownMatricesNotice {...markdownConfig} />

      <section
        className="grid gap-4 md:grid-cols-[1.15fr_1fr]"
        aria-label="Expiry stock action summary"
      >
        <div
          className="rounded-lg border border-semantic-critical-muted bg-semantic-critical-muted p-4"
          role="region"
          aria-label="Expired stock to write off"
        >
          <p className="text-sm font-medium text-semantic-critical-muted-foreground">
            Expired — write off
          </p>
          <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-semantic-critical">
            <ExpiredCountValue count={expiredCount} />
          </p>
          <p className="mt-2 text-sm text-semantic-critical-muted-foreground">
            These lines are past expiry. Write them off on the Expired items page.
          </p>
          <Link
            to="/expired-items"
            className="mt-1 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-semantic-critical-muted-foreground underline underline-offset-4 outline-hidden focus-visible:ring-[3px] focus-visible:ring-semantic-primary/50"
          >
            Write off on Expired items
          </Link>
        </div>
        <dl className="grid gap-3 rounded-lg border bg-semantic-surface-2 p-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-semantic-text-secondary">Markdown action</dt>
            <dd className="mt-1 font-heading text-2xl font-bold tabular-nums text-semantic-text-primary">
              {numberFormatter.format(expirySummary.markdown)}
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-semantic-text-secondary">
              Active expiry stock
            </dt>
            <dd className="mt-1 font-heading text-2xl font-bold tabular-nums text-semantic-text-primary">
              {numberFormatter.format(expirySummary.active)}
            </dd>
          </div>
        </dl>
      </section>

      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 rounded-lg border border-semantic-critical-muted bg-semantic-critical-muted px-4 py-3 text-sm text-semantic-critical-muted-foreground"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
            className="-my-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-lg outline-hidden focus-visible:ring-[3px] focus-visible:ring-semantic-primary/50"
          >
            &times;
          </button>
        </div>
      )}

      {hasData ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>
              <h2 className="text-xl font-semibold">This month&apos;s markdown worklist</h2>
            </CardTitle>
            <p className="mt-1 text-sm text-semantic-text-secondary">
              Work top to bottom: apply the first markdown, then deepen or record sold-through
              stock.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {WORKLIST_GROUPS.map(({ key, label, hint }) => {
              const items = worklistGroups[key];
              return (
                <section key={key} aria-labelledby={`worklist-group-${key}`}>
                  <div className="flex items-baseline justify-between gap-3 border-b pb-2">
                    <h3
                      id={`worklist-group-${key}`}
                      className="font-heading text-base font-semibold"
                    >
                      {label}
                    </h3>
                    <span className="text-sm tabular-nums text-semantic-text-secondary">
                      {numberFormatter.format(items.length)} item{items.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-semantic-text-tertiary">{hint}</p>
                  {items.length === 0 ? (
                    <p className="mt-3 text-sm text-semantic-text-secondary">
                      Nothing in this group right now.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {items.map((item) => {
                        const daysToExpiry = getDaysToExpiry(item.expiryDate);
                        const matrix = markdownConfig.matrices?.[item.creditScope ?? 'NO_CREDIT'];
                        const markdownPrice = matrix
                          ? (calculateMarkdownPrice(
                              { costPrice: item.costPrice, retailPrice: item.retailPrice },
                              daysToExpiry,
                              matrix,
                            ) ?? item.costPrice)
                          : null;
                        const isSubmitting = soldThroughId === item.inventoryId;
                        return (
                          <li
                            key={item.inventoryId}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-semantic-surface-1 p-3"
                          >
                            <div className="min-w-0">
                              <p className="break-words font-medium">{item.productName}</p>
                              <p className="mt-0.5 text-sm text-semantic-text-secondary">
                                {item.sku} · {item.locationName} · {formatDaysLeft(daysToExpiry)}
                              </p>
                              <div className="mt-2">
                                <MarkdownCreditScopeBadge
                                  creditScope={item.creditScope ?? 'NO_CREDIT'}
                                  creditScopeReason={item.creditScopeReason ?? 'NO_CREDIT'}
                                  creditSupplierId={item.creditSupplierId ?? null}
                                  creditSupplierName={item.creditSupplierName ?? null}
                                />
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="tabular-nums text-sm font-medium">
                                <span className="sr-only">Markdown price: </span>
                                {markdownPrice == null
                                  ? 'Unavailable'
                                  : formatCurrencyValue(markdownPrice)}
                              </span>
                              <Button
                                onClick={() => handleSoldThrough(item.inventoryId)}
                                disabled={isSubmitting || soldThroughId !== null}
                                variant="default"
                                className="min-h-11"
                                aria-busy={isSubmitting}
                              >
                                {isSubmitting ? 'Recording…' : 'Sold through'}
                                <span className="sr-only">: {item.productName}</span>
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent>
            <p className="py-8 text-center text-sm text-semantic-text-secondary">
              No expiry items found in the next 90 days.
            </p>
          </CardContent>
        </Card>
      )}

      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.visible}
        onClose={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </section>
  );
}
