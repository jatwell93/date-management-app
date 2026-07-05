import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Button } from '../components/ui/button';
import { apiService } from '../lib/api.service';
import { useFreshApiToken } from '../hooks/useFreshApiToken';

interface ReportsPageProps {
  token: string | null;
}

interface MonthlyExpiryReportItem {
  month: string;
  total_expiring: number;
  expired_count: number;
  total_markdown: number;
  expiry_risk_count: number;
  next_month_markdown_count: number;
  active_expiry_stock_count: number;
  latest_expiry_date: string;
}

type RawMonthlyExpiryReportItem = Partial<
  Omit<MonthlyExpiryReportItem, 'latest_expiry_date' | 'month'>
> & {
  month?: string | null;
  latest_expiry_date?: string | null;
};

interface SellThroughByLevelItem {
  markdownLevel: number | null;
  soldCount: number;
}

const MARKDOWN_LEVEL_LABELS: Record<string, string> = {
  '1': 'Markdown 1 (61–90 days)',
  '2': 'Markdown 2 (31–60 days)',
  '3': 'Markdown 3 (0–30 days)',
  none: 'Sold before markdown',
};

function markdownLevelLabel(level: number | null): string {
  return MARKDOWN_LEVEL_LABELS[level === null ? 'none' : String(level)] ?? `Level ${level}`;
}

const numberFormatter = new Intl.NumberFormat('en-AU');
const dateFormatter = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' });
type RequiredOverallSummaryField =
  | 'expiry_risk_count'
  | 'next_month_markdown_count'
  | 'active_expiry_stock_count';

function formatReportDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not available' : dateFormatter.format(date);
}

function normalizeReportNumber(value: unknown): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeRequiredReportNumber(
  item: RawMonthlyExpiryReportItem,
  field: RequiredOverallSummaryField,
): number {
  const rawValue = item[field];
  if (
    !Object.prototype.hasOwnProperty.call(item, field) ||
    rawValue === null ||
    rawValue === undefined
  ) {
    throw new Error(`Expiry summary response is missing ${field}.`);
  }

  const numberValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expiry summary response has invalid ${field}.`);
  }

  return numberValue;
}

function normalizeMonthlyExpiryReportItem(
  item: RawMonthlyExpiryReportItem,
): MonthlyExpiryReportItem {
  return {
    month: item.month || 'Unknown',
    total_expiring: normalizeReportNumber(item.total_expiring),
    expired_count: normalizeReportNumber(item.expired_count),
    total_markdown: normalizeReportNumber(item.total_markdown),
    expiry_risk_count: normalizeReportNumber(item.expiry_risk_count),
    next_month_markdown_count: normalizeReportNumber(item.next_month_markdown_count),
    active_expiry_stock_count: normalizeReportNumber(item.active_expiry_stock_count),
    latest_expiry_date: item.latest_expiry_date || '',
  };
}

function normalizeOverallExpiryReportItem(
  item: RawMonthlyExpiryReportItem,
): MonthlyExpiryReportItem {
  return {
    ...normalizeMonthlyExpiryReportItem(item),
    expiry_risk_count: normalizeRequiredReportNumber(item, 'expiry_risk_count'),
    next_month_markdown_count: normalizeRequiredReportNumber(item, 'next_month_markdown_count'),
    active_expiry_stock_count: normalizeRequiredReportNumber(item, 'active_expiry_stock_count'),
  };
}

const SKELETON_ROWS = Array.from({ length: 6 }, (_, i) => i);

export function ReportsPage({ token }: ReportsPageProps) {
  const navigate = useNavigate();
  const getFreshApiToken = useFreshApiToken(token);
  const [reportData, setReportData] = useState<MonthlyExpiryReportItem[] | null>(null);
  const [overallReportData, setOverallReportData] = useState<MonthlyExpiryReportItem | null>(null);
  const [sellThroughData, setSellThroughData] = useState<SellThroughByLevelItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [overallLoading, setOverallLoading] = useState(true);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);
  const [overallError, setOverallError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const fetchReportData = async () => {
      setLoading(true);
      setMonthlyError(null);

      if (!token) {
        setMonthlyError('Authentication token is missing.');
        setLoading(false);
        return;
      }

      try {
        const authToken = await getFreshApiToken('reports-expiry-monthly');
        const data = await apiService.get<RawMonthlyExpiryReportItem[]>(
          '/reports/expiry',
          authToken,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setReportData((data ?? []).map(normalizeMonthlyExpiryReportItem));
          setMonthlyError(null);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        if (err instanceof Error) {
          setMonthlyError(err.message);
        } else {
          setMonthlyError('An unknown error occurred');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    const fetchOverallReportData = async () => {
      setOverallLoading(true);
      setOverallError(null);

      if (!token) {
        setOverallError('Authentication token is missing.');
        setOverallLoading(false);
        return;
      }

      try {
        const authToken = await getFreshApiToken('reports-expiry-overall');
        const data = await apiService.get<RawMonthlyExpiryReportItem>(
          '/reports/expiry-overall',
          authToken,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setOverallReportData(data ? normalizeOverallExpiryReportItem(data) : null);
          setOverallError(null);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setOverallReportData(null);
        if (err instanceof Error) {
          setOverallError(err.message);
        } else {
          setOverallError('An unknown error occurred');
        }
      } finally {
        if (!controller.signal.aborted) {
          setOverallLoading(false);
        }
      }
    };

    const fetchSellThroughData = async () => {
      if (!token) return;
      try {
        const authToken = await getFreshApiToken('reports-sell-through');
        const data = await apiService.get<SellThroughByLevelItem[]>(
          '/reports/sell-through',
          authToken,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setSellThroughData(data ?? []);
        }
      } catch {
        // Sell-through is a secondary insight; ignore failures rather than blocking the page.
        if (!controller.signal.aborted) {
          setSellThroughData([]);
        }
      }
    };

    fetchReportData();
    fetchOverallReportData();
    fetchSellThroughData();
    return () => controller.abort();
  }, [token, getFreshApiToken]);

  const hasAnyError = monthlyError || overallError;

  if (loading && overallLoading) {
    return (
      <div
        className="container mx-auto max-w-6xl px-4 py-8"
        role="status"
        aria-live="polite"
        aria-label="Loading expiry reports"
      >
        <div className="mb-6">
          <div className="h-8 w-56 rounded-md bg-semantic-surface-3 animate-pulse" />
          <div className="mt-2 h-4 w-96 rounded bg-semantic-surface-3 animate-pulse" />
        </div>
        <div className="mb-6 rounded-xl border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <div className="h-5 w-44 rounded bg-semantic-surface-3 animate-pulse" />
          </div>
          <div className="px-6 py-5 grid gap-4 md:grid-cols-[1.2fr_1fr]">
            <div className="rounded-lg border bg-semantic-surface-3 h-28 animate-pulse" />
            <div className="rounded-lg border bg-semantic-surface-3 h-28 animate-pulse" />
          </div>
        </div>
        <div className="rounded-xl border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <div className="h-5 w-44 rounded bg-semantic-surface-3 animate-pulse" />
          </div>
          <div className="px-6 py-5">
            {SKELETON_ROWS.map((i) => (
              <div key={i} className="flex gap-6 py-3 border-b last:border-0">
                <div className="h-4 w-20 rounded bg-semantic-surface-3 animate-pulse" />
                <div className="h-4 w-16 rounded bg-semantic-surface-3 animate-pulse ml-auto" />
                <div className="h-4 w-16 rounded bg-semantic-surface-3 animate-pulse" />
                <div className="h-4 w-16 rounded bg-semantic-surface-3 animate-pulse" />
                <div className="h-4 w-24 rounded bg-semantic-surface-3 animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (hasAnyError && !reportData && !overallReportData) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-semantic-critical font-medium" role="alert">
            {monthlyError || overallError}
          </p>
          <button
            onClick={() => navigate(0)}
            className="rounded-md border border-semantic-primary px-4 py-2 text-sm font-medium text-semantic-primary hover:bg-semantic-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-primary transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <main
      className="container mx-auto max-w-6xl space-y-6 px-4 py-8"
      aria-label="Expiry reporting workspace"
    >
      <header>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold">Expiry reporting</h1>
            <p className="mt-1.5 max-w-xl text-sm text-semantic-text-secondary">
              Start with expired stock and markdown pressure, then review month-by-month movement.
            </p>
          </div>
        </div>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Expiry action summary</CardTitle>
        </CardHeader>
        <CardContent>
          {overallLoading ? (
            <div
              className="grid gap-4 md:grid-cols-[1.2fr_1fr]"
              role="status"
              aria-live="polite"
              aria-label="Loading expiry summary"
            >
              <div className="rounded-lg border bg-semantic-surface-3 h-28 animate-pulse" />
              <div className="rounded-lg border bg-semantic-surface-3 h-28 animate-pulse" />
            </div>
          ) : overallError ? (
            <p className="text-semantic-critical text-sm" role="alert">
              {overallError}
            </p>
          ) : overallReportData ? (
            <section
              className="grid gap-4 md:grid-cols-[1.2fr_1fr]"
              aria-label="Expiry stock action summary"
            >
              <div
                className="rounded-lg border border-semantic-critical-muted bg-semantic-critical-muted p-5"
                role="region"
                aria-label="Primary expiry decision"
              >
                <p className="text-sm font-medium text-semantic-critical">Expiry risk</p>
                <p className="mt-2 font-heading text-3xl font-bold text-semantic-critical">
                  {numberFormatter.format(overallReportData.expiry_risk_count)}
                </p>
                <p className="mt-2 text-sm text-semantic-critical-muted-foreground">
                  Stock expiring within 30 days — apply the deepest reduction (Markdown 3) before it
                  becomes unsellable.
                </p>
              </div>
              <dl className="grid gap-3 rounded-lg border bg-semantic-secondary-muted p-5 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-semantic-text-secondary">
                    Entering markdown next month
                  </dt>
                  <dd className="mt-1 font-heading text-2xl font-bold text-semantic-warning">
                    {numberFormatter.format(overallReportData.next_month_markdown_count)}
                  </dd>
                  <dd className="mt-1 text-xs text-semantic-text-secondary">
                    Next batch crossing into Markdown 1 (≈3 months out) — line up first reductions.
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-semantic-text-secondary">
                    Active expiry stock
                  </dt>
                  <dd className="mt-1 font-heading text-2xl font-bold text-semantic-success">
                    {numberFormatter.format(overallReportData.active_expiry_stock_count)}
                  </dd>
                  <dd className="mt-1 text-xs text-semantic-text-secondary">
                    All stock not yet expired — your live markdown pipeline.
                  </dd>
                </div>
              </dl>
            </section>
          ) : (
            <p className="text-center text-semantic-text-secondary">
              No expiry actions need review yet.
            </p>
          )}
        </CardContent>
      </Card>

      {sellThroughData && sellThroughData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Sell-through by markdown level</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-semantic-text-secondary">
              How many items sold at each reduction depth — stock that only moves at deeper
              markdowns is a candidate for range or ordering review.
            </p>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {sellThroughData.map((row) => (
                <div
                  key={row.markdownLevel === null ? 'none' : row.markdownLevel}
                  className="rounded-lg border bg-semantic-surface-1 p-4"
                >
                  <dt className="text-sm font-medium text-semantic-text-secondary">
                    {markdownLevelLabel(row.markdownLevel)}
                  </dt>
                  <dd className="mt-1 font-heading text-2xl font-bold">
                    {numberFormatter.format(row.soldCount)}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Monthly expiry report</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="no-print mb-4 flex flex-col gap-2 sm:flex-row">
            <Button asChild className="flex-1" size="lg">
              <a href="/detailed-expiry-report">Open next 90 days</a>
            </Button>
            <Button asChild variant="destructive" className="flex-1" size="lg">
              <a href="/expired-items">Review expired items</a>
            </Button>
          </div>
          {loading ? (
            <div className="text-center" role="status" aria-live="polite">
              Loading monthly report…
            </div>
          ) : monthlyError ? (
            <p className="text-semantic-critical text-sm" role="alert">
              {monthlyError}
            </p>
          ) : reportData && reportData.length > 0 ? (
            <>
              {/* Mobile row summary */}
              <ul className="mb-5 space-y-3 md:hidden" aria-label="Mobile monthly expiry summary">
                {reportData.map((row) => (
                  <li key={row.month} className="rounded-lg border bg-semantic-surface-1 p-4">
                    <div className="flex items-center justify-between border-b pb-2 mb-3">
                      <span className="font-heading font-bold text-lg">{row.month}</span>
                      <span className="rounded-md bg-semantic-secondary-muted px-2 py-1 text-xs font-medium text-semantic-text-secondary">
                        Total: {numberFormatter.format(row.total_expiring)}
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div className="flex justify-between border-b border-dashed pb-1">
                        <dt className="text-semantic-text-secondary">Expired</dt>
                        <dd className="font-bold text-semantic-critical">
                          {numberFormatter.format(row.expired_count)}
                        </dd>
                      </div>
                      <div className="flex justify-between border-b border-dashed pb-1">
                        <dt className="text-semantic-text-secondary">Latest Expiry</dt>
                        <dd className="font-medium">{formatReportDate(row.latest_expiry_date)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>

              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-semantic-surface-2 hover:bg-semantic-surface-2">
                      <TableHead className="text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                        Month
                      </TableHead>
                      <TableHead className="text-right text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                        Total Expiring
                      </TableHead>
                      <TableHead className="text-right text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                        Expired Items
                      </TableHead>
                      <TableHead className="text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                        Latest Expiry
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportData.map((row) => (
                      <TableRow key={row.month}>
                        <TableCell className="font-medium">{row.month}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {numberFormatter.format(row.total_expiring)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-semantic-critical font-bold">
                          {numberFormatter.format(row.expired_count)}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {formatReportDate(row.latest_expiry_date)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <p className="text-center text-semantic-text-secondary">
              No monthly expiry movement is ready for review.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
