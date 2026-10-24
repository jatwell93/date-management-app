import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { apiService } from '../lib/api.service';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { semanticDataViz } from '../theme/semantic-tokens';
import { useFreshApiToken } from '../hooks/useFreshApiToken';

// Chart.js is loaded on demand via the shared lazy chart module, keeping it out of
// the initial bundle (chart.js registration lives inside that lazily-loaded chunk).
const Bar = lazy(() => import('../components/charts/lazyCharts').then((m) => ({ default: m.Bar })));
const Line = lazy(() =>
  import('../components/charts/lazyCharts').then((m) => ({ default: m.Line })),
);

interface UsageReportPageProps {
  token: string | null;
}

interface DailyUsageReportItem {
  date: string; // YYYY-MM-DD
  user_id: number | null;
  user_name: string | null;
  user_role: string;
  creations: number;
  updates: number;
  deletions: number;
}

interface ItemsByUserReportItem {
  userId: number;
  userName: string;
  itemCount: number;
}

interface ItemsByDateReportItem {
  date: string; // YYYY-MM-DD
  itemCount: number;
}

interface StoreWalkAuditUser {
  userId: number;
  userName: string;
  baysChecked: number;
  coveragePercent: number;
  baysPerHour: number;
}

interface StoreWalkAuditFlag {
  type: 'implausible_pace' | 'all_zero_findings' | string;
  userName: string;
  message: string;
}

interface StoreWalkAuditCycle {
  cycleId: number;
  cycleName: string;
  status: string;
  completionMinutes: number | null;
  users: StoreWalkAuditUser[];
  flags: StoreWalkAuditFlag[];
}

const numberFormatter = new Intl.NumberFormat('en-AU');
const dateFormatter = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' });

function formatUsageDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not available' : dateFormatter.format(date);
}

function formatUserLabel(item: ItemsByUserReportItem) {
  return item.userName || `Unknown user ${item.userId}`;
}

function formatDailyUserLabel(row: DailyUsageReportItem) {
  if (row.user_name) return row.user_name;
  return row.user_id === null ? 'Unknown user' : `Unknown user ${row.user_id}`;
}

function formatAuditFlagType(type: string) {
  if (type === 'implausible_pace') return 'Implausible pace';
  if (type === 'all_zero_findings') return 'All-zero findings';
  return type
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

interface ReportFetchOptions<T> {
  token: string | null;
  signal: AbortSignal;
  getFreshApiToken: (actionTag: string) => Promise<string | undefined>;
  actionTag: string;
  endpoint: string;
  unknownErrorMessage: string;
  /** Runs before the token check (set loading true, clear error). Omit for fetchers that don't. */
  onStart?: () => void;
  /** Handles the absent-token case; responsible for clearing its own loading flag. */
  onMissingToken: () => void;
  /** Applies fetched data (and any success-side error clearing). Only called when not aborted. */
  onData: (data: T) => void;
  onError: (message: string) => void;
  /** Runs in `finally` when not aborted (clear loading flag). */
  onSettled: () => void;
}

// Shared skeleton for the report fetchers: abort-guarded token check → GET → data/error/settled.
// Each effect supplies its own state setters and copy so behavior stays identical to before.
async function runReportFetch<T>(options: ReportFetchOptions<T>): Promise<void> {
  const {
    token,
    signal,
    getFreshApiToken,
    actionTag,
    endpoint,
    unknownErrorMessage,
    onStart,
    onMissingToken,
    onData,
    onError,
    onSettled,
  } = options;

  onStart?.();

  if (!token) {
    onMissingToken();
    return;
  }

  try {
    const authToken = await getFreshApiToken(actionTag);
    const data = await apiService.get<T>(endpoint, authToken, signal);
    if (!signal.aborted) {
      onData(data);
    }
  } catch (err: unknown) {
    if (signal.aborted) return;
    onError(err instanceof Error ? err.message : unknownErrorMessage);
  } finally {
    if (!signal.aborted) {
      onSettled();
    }
  }
}

export function UsageReportPage({ token }: UsageReportPageProps) {
  const getFreshApiToken = useFreshApiToken(token);
  const [usageData, setUsageData] = useState<DailyUsageReportItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [itemsByUser, setItemsByUser] = useState<ItemsByUserReportItem[] | null>(null);
  const [itemsByDate, setItemsByDate] = useState<ItemsByDateReportItem[] | null>(null);
  const [storeWalkAudit, setStoreWalkAudit] = useState<StoreWalkAuditCycle[] | null>(null);
  const [itemsByUserLoading, setItemsByUserLoading] = useState(true);
  const [itemsByDateLoading, setItemsByDateLoading] = useState(true);
  const [storeWalkAuditLoading, setStoreWalkAuditLoading] = useState(true);
  // Separate error per chart fetch: a shared flag let one fetch's success clear the other's error.
  const [itemsByUserError, setItemsByUserError] = useState<string | null>(null);
  const [itemsByDateError, setItemsByDateError] = useState<string | null>(null);
  const [storeWalkAuditError, setStoreWalkAuditError] = useState<string | null>(null);
  const [timeFrame, setTimeFrame] = useState('all-time');
  const chartsLoading = itemsByUserLoading || itemsByDateLoading;

  // Daily usage — no pre-fetch reset (initial loading state already true).
  useEffect(() => {
    const controller = new AbortController();
    runReportFetch<DailyUsageReportItem[]>({
      token,
      signal: controller.signal,
      getFreshApiToken,
      actionTag: 'usage-report-daily',
      endpoint: '/reports/daily-usage',
      unknownErrorMessage: 'An unknown error occurred',
      onMissingToken: () => {
        setUsageError('Authentication token is missing.');
        setLoading(false);
      },
      onData: (data) => setUsageData(data),
      onError: (message) => setUsageError(message),
      onSettled: () => setLoading(false),
    });
    return () => controller.abort();
  }, [token, getFreshApiToken]);

  // Items-by-date (independent of timeFrame).
  useEffect(() => {
    const controller = new AbortController();
    runReportFetch<ItemsByDateReportItem[]>({
      token,
      signal: controller.signal,
      getFreshApiToken,
      actionTag: 'usage-report-items-by-date',
      endpoint: '/reports/items-by-date',
      unknownErrorMessage: 'An unknown error occurred when fetching chart data',
      onStart: () => {
        setItemsByDateLoading(true);
        setItemsByDateError(null);
      },
      onMissingToken: () => setItemsByDateLoading(false),
      onData: (data) => {
        setItemsByDate(data);
        setItemsByDateError(null);
      },
      onError: (message) => setItemsByDateError(message),
      onSettled: () => setItemsByDateLoading(false),
    });
    return () => controller.abort();
  }, [token, getFreshApiToken]);

  // Items-by-user (depends on timeFrame).
  useEffect(() => {
    const controller = new AbortController();
    runReportFetch<ItemsByUserReportItem[]>({
      token,
      signal: controller.signal,
      getFreshApiToken,
      actionTag: 'usage-report-items-by-user',
      endpoint: `/reports/items-by-user?timeFrame=${timeFrame}`,
      unknownErrorMessage: 'An unknown error occurred when fetching chart data',
      onStart: () => {
        setItemsByUserLoading(true);
        setItemsByUserError(null);
      },
      onMissingToken: () => {
        setItemsByUserError('Authentication token is missing.');
        setItemsByUserLoading(false);
      },
      onData: (data) => {
        setItemsByUser(data);
        setItemsByUserError(null);
      },
      onError: (message) => setItemsByUserError(message),
      onSettled: () => setItemsByUserLoading(false),
    });
    return () => controller.abort();
  }, [token, timeFrame, getFreshApiToken]);

  // Store walk audit.
  useEffect(() => {
    const controller = new AbortController();
    runReportFetch<StoreWalkAuditCycle[]>({
      token,
      signal: controller.signal,
      getFreshApiToken,
      actionTag: 'usage-report-store-walk-audit',
      endpoint: '/reports/store-walk-audit',
      unknownErrorMessage: 'An unknown error occurred when fetching walk audit',
      onStart: () => {
        setStoreWalkAuditLoading(true);
        setStoreWalkAuditError(null);
      },
      onMissingToken: () => setStoreWalkAuditLoading(false),
      onData: (data) => setStoreWalkAudit(data),
      onError: (message) => setStoreWalkAuditError(message),
      onSettled: () => setStoreWalkAuditLoading(false),
    });
    return () => controller.abort();
  }, [token, getFreshApiToken]);

  // Prepare chart data for Items by User
  const itemsByUserChartData = useMemo(
    () => ({
      labels: itemsByUser?.map((item) => formatUserLabel(item)) || [],
      datasets: [
        {
          label: 'Items Added',
          data: itemsByUser?.map((item) => item.itemCount) || [],
          // Teal (series1) clears the 3:1 non-text contrast floor on white; green/sky do not.
          backgroundColor: semanticDataViz.series1,
          borderColor: semanticDataViz.series1,
          borderWidth: 1,
        },
      ],
    }),
    [itemsByUser],
  );

  // Prepare chart data for Items by Date
  const itemsByDateChartData = useMemo(
    () => ({
      labels: itemsByDate?.map((item) => formatUsageDate(item.date)) || [],
      datasets: [
        {
          label: 'Items Added',
          data: itemsByDate?.map((item) => item.itemCount) || [],
          fill: false,
          borderColor: semanticDataViz.series1,
          backgroundColor: semanticDataViz.series1,
          tension: 0.1,
        },
      ],
    }),
    [itemsByDate],
  );

  // The card h2 already titles each chart, so the in-canvas title is hidden (its text lives
  // on as the canvas aria-label). Both charts share one options object.
  // Chart.js animates on draw regardless of the OS setting; honour reduced motion.
  const prefersReducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const lineChartOptions = useMemo(
    () => ({
      responsive: true,
      ...(prefersReducedMotion ? { animation: false as const } : {}),
      plugins: {
        title: {
          display: false,
        },
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
        },
      },
    }),
    [prefersReducedMotion],
  );

  const barChartOptions = useMemo(
    () => ({ ...lineChartOptions, maintainAspectRatio: false }),
    [lineChartOptions],
  );

  if (loading) {
    return (
      <div className="py-8 text-center" role="status" aria-live="polite">
        Loading usage report…
      </div>
    );
  }

  if (usageError && !usageData) {
    return (
      <div className="py-8 text-center text-semantic-critical" role="alert">
        {usageError}
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-7" aria-labelledby="usage-report-heading">
      <header className="max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 id="usage-report-heading" className="font-heading text-2xl font-semibold">
            Usage Report
          </h1>
        </div>
        <p className="mt-2 text-sm text-semantic-text-secondary">
          See which team members are adding stock, and review daily adds, edits, and removals over
          the last 90 days.
        </p>
      </header>
      {/* Chart Section */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Card role="region" aria-labelledby="usage-report-by-user-heading">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <CardTitle>
                <h2 id="usage-report-by-user-heading" className="text-xl font-semibold">
                  Stock Added by Team Member
                </h2>
              </CardTitle>
              <span id="usage-report-timeframe-label" className="sr-only">
                Time frame
              </span>
              <Select value={timeFrame} onValueChange={setTimeFrame}>
                <SelectTrigger
                  id="usage-report-timeframe"
                  aria-labelledby="usage-report-timeframe-label usage-report-timeframe"
                  className="min-h-11 w-full sm:w-[180px]"
                >
                  <SelectValue placeholder="Select time frame" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                  <SelectItem value="all-time">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {chartsLoading ? (
              <div className="text-center py-8" role="status" aria-live="polite">
                Loading chart data…
              </div>
            ) : itemsByUserError ? (
              <p className="text-semantic-critical text-sm" role="alert">
                {itemsByUserError}
              </p>
            ) : itemsByUser && itemsByUser.length > 0 ? (
              <div className="space-y-4">
                {/* maintainAspectRatio is off, so the container must own the height at every width. */}
                <div className="aspect-[4/3] w-full sm:aspect-auto sm:h-64">
                  <Suspense
                    fallback={
                      <div className="h-64 motion-safe:animate-pulse rounded bg-semantic-surface-3" />
                    }
                  >
                    <Bar
                      role="img"
                      aria-label="Bar chart of items added per team member. The same figures are listed below."
                      data={itemsByUserChartData}
                      options={barChartOptions}
                    />
                  </Suspense>
                </div>
                {/* Mobile row summary for Items by User */}
                <ul className="space-y-3 sm:hidden" aria-label="Stock added by team member">
                  {itemsByUser.map((item) => (
                    <li
                      key={item.userId}
                      className="flex items-center justify-between rounded-md border bg-semantic-surface-2 p-3 text-sm"
                    >
                      <span className="font-medium text-semantic-text-primary">
                        {formatUserLabel(item)}
                      </span>
                      <span className="font-bold tabular-nums text-semantic-text-primary">
                        {numberFormatter.format(item.itemCount)} items
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="hidden sm:block">
                  <Table aria-label="Items added by user summary">
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead className="text-right">Items added</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itemsByUser.map((item) => (
                        <TableRow key={item.userId}>
                          <TableCell>{formatUserLabel(item)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {numberFormatter.format(item.itemCount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-semantic-text-tertiary">
                No stock additions recorded for this period.
              </div>
            )}
          </CardContent>
        </Card>

        <Card role="region" aria-labelledby="usage-report-by-date-heading">
          <CardHeader>
            <CardTitle>
              <h2 id="usage-report-by-date-heading" className="text-xl font-semibold">
                Daily Stock Additions
              </h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Loading is shared with the card above (charts appear together), which already
                announces it, so no live role here. */}
            {chartsLoading ? (
              <div className="text-center py-8">Loading chart data…</div>
            ) : itemsByDateError ? (
              <p className="text-semantic-critical text-sm" role="alert">
                {itemsByDateError}
              </p>
            ) : itemsByDate && itemsByDate.length > 0 ? (
              <div className="space-y-4">
                <Suspense
                  fallback={
                    <div className="h-64 motion-safe:animate-pulse rounded bg-semantic-surface-3" />
                  }
                >
                  <Line
                    role="img"
                    aria-label="Line chart of stock additions over time. The same figures are listed below."
                    data={itemsByDateChartData}
                    options={lineChartOptions}
                  />
                </Suspense>
                <Table aria-label="Items added per day summary">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Items added</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itemsByDate.map((item) => (
                      <TableRow key={item.date}>
                        <TableCell>{formatUsageDate(item.date)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {numberFormatter.format(item.itemCount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-4 text-semantic-text-tertiary">
                No daily stock additions recorded yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card role="region" aria-labelledby="usage-report-walk-audit-heading">
        <CardHeader>
          <CardTitle>
            <h2 id="usage-report-walk-audit-heading" className="text-xl font-semibold">
              Store Walk Audit
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {storeWalkAuditLoading ? (
            <div className="text-center py-8" role="status" aria-live="polite">
              Loading store walk audit…
            </div>
          ) : storeWalkAuditError ? (
            <p className="text-semantic-critical text-sm" role="alert">
              {storeWalkAuditError}
            </p>
          ) : storeWalkAudit && storeWalkAudit.length > 0 ? (
            <div className="space-y-5">
              {storeWalkAudit.map((cycle) => (
                <section key={cycle.cycleId} className="space-y-3" aria-label={cycle.cycleName}>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="font-heading text-base font-semibold">{cycle.cycleName}</h3>
                    <span className="text-sm text-semantic-text-secondary">
                      {cycle.completionMinutes === null
                        ? 'In progress'
                        : `${numberFormatter.format(cycle.completionMinutes)} min`}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <Table aria-label={`${cycle.cycleName} store walk productivity`}>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead className="text-right">Bays checked</TableHead>
                          <TableHead className="text-right">Coverage</TableHead>
                          <TableHead className="text-right">Pace</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cycle.users.map((user) => (
                          <TableRow key={`${cycle.cycleId}-${user.userId}`}>
                            <TableCell>{user.userName || `Unknown user ${user.userId}`}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {numberFormatter.format(user.baysChecked)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {numberFormatter.format(user.coveragePercent)}%
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {numberFormatter.format(user.baysPerHour)} bays/hour
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {cycle.flags.length > 0 && (
                    <ul className="grid gap-2" aria-label={`${cycle.cycleName} red flags`}>
                      {cycle.flags.map((flag) => (
                        <li
                          key={`${cycle.cycleId}-${flag.type}-${flag.userName}-${flag.message}`}
                          className="rounded-md border border-semantic-critical/30 bg-semantic-critical-muted p-3 text-sm"
                        >
                          <p className="font-medium text-semantic-critical-muted-foreground">
                            {formatAuditFlagType(flag.type)}
                          </p>
                          <p className="text-semantic-critical-muted-foreground">{flag.userName}</p>
                          <p className="text-semantic-critical-muted-foreground">{flag.message}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <p className="text-center text-semantic-text-secondary">
              No store walk audit data recorded yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Original Table Section */}
      <Card role="region" aria-labelledby="usage-report-daily-activity-heading">
        <CardHeader>
          <CardTitle>
            <h2 id="usage-report-daily-activity-heading" className="text-xl font-semibold">
              Daily Activity — Last 90 Days
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {usageData && usageData.length > 0 ? (
            <>
              {/* Mobile daily activity summary */}
              <ul className="mb-5 space-y-3 md:hidden" aria-label="Daily activity">
                {usageData.map((row) => (
                  <li
                    key={`${row.date}-${row.user_id}`}
                    className="rounded-lg border bg-semantic-surface-1 p-4"
                  >
                    <div className="flex items-center justify-between border-b pb-2 mb-3">
                      <span className="font-heading font-bold">{formatUsageDate(row.date)}</span>
                      <span className="text-sm text-semantic-text-secondary">
                        {formatDailyUserLabel(row)} · {row.user_role}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-sm">
                      <div className="rounded border bg-semantic-surface-2 p-2">
                        <p className="text-semantic-text-secondary">Items added</p>
                        <p className="text-lg font-bold tabular-nums text-semantic-text-primary">
                          {numberFormatter.format(row.creations)}
                        </p>
                      </div>
                      <div className="rounded border bg-semantic-surface-2 p-2">
                        <p className="text-semantic-text-secondary">Items edited</p>
                        <p className="text-lg font-bold tabular-nums text-semantic-text-primary">
                          {numberFormatter.format(row.updates)}
                        </p>
                      </div>
                      <div className="rounded border bg-semantic-surface-2 p-2">
                        <p className="text-semantic-text-secondary">Items removed</p>
                        <p className="text-lg font-bold tabular-nums text-semantic-text-primary">
                          {numberFormatter.format(row.deletions)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="hidden md:block overflow-x-auto">
                <Table aria-label="Daily activity by user">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Added</TableHead>
                      <TableHead className="text-right">Edited</TableHead>
                      <TableHead className="text-right">Removed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usageData.map((row) => (
                      <TableRow key={`${row.date}-${row.user_id}`}>
                        <TableCell className="font-medium">{formatUsageDate(row.date)}</TableCell>
                        <TableCell>{formatDailyUserLabel(row)}</TableCell>
                        <TableCell>{row.user_role}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {numberFormatter.format(row.creations)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {numberFormatter.format(row.updates)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {numberFormatter.format(row.deletions)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <p className="text-center text-semantic-text-secondary">
              No activity recorded in the last 90 days.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
