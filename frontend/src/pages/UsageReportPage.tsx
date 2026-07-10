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

// Import Chart.js components — lazy-loaded to keep initial bundle lean
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
);

const Bar = lazy(() => import('react-chartjs-2').then((m) => ({ default: m.Bar })));
const Line = lazy(() => import('react-chartjs-2').then((m) => ({ default: m.Line })));

interface UsageReportPageProps {
  token: string | null;
}

interface DailyUsageReportItem {
  date: string; // YYYY-MM-DD
  user_id: number;
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

function formatAuditFlagType(type: string) {
  if (type === 'implausible_pace') return 'Implausible pace';
  if (type === 'all_zero_findings') return 'All-zero findings';
  return type
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
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
  const [chartsError, setChartsError] = useState<string | null>(null);
  const [storeWalkAuditError, setStoreWalkAuditError] = useState<string | null>(null);
  const [timeFrame, setTimeFrame] = useState('all-time');
  const chartsLoading = itemsByUserLoading || itemsByDateLoading;

  useEffect(() => {
    const controller = new AbortController();

    const fetchUsageData = async () => {
      if (!token) {
        setUsageError('Authentication token is missing.');
        setLoading(false);
        return;
      }

      try {
        const authToken = await getFreshApiToken('usage-report-daily');
        const data = await apiService.get<DailyUsageReportItem[]>(
          '/reports/daily-usage',
          authToken,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setUsageData(data);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        if (err instanceof Error) {
          setUsageError(err.message);
        } else {
          setUsageError('An unknown error occurred');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchUsageData();
    return () => controller.abort();
  }, [token, getFreshApiToken]);

  // Fetch items-by-date (independent of timeFrame)
  useEffect(() => {
    const controller = new AbortController();

    const fetchItemsByDate = async () => {
      setItemsByDateLoading(true);
      setChartsError(null);

      if (!token) {
        setItemsByDateLoading(false);
        return;
      }

      try {
        const authToken = await getFreshApiToken('usage-report-items-by-date');
        const data = await apiService.get<ItemsByDateReportItem[]>(
          '/reports/items-by-date',
          authToken,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setItemsByDate(data);
          setChartsError(null);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        if (err instanceof Error) {
          setChartsError(err.message);
        } else {
          setChartsError('An unknown error occurred when fetching chart data');
        }
      } finally {
        if (!controller.signal.aborted) {
          setItemsByDateLoading(false);
        }
      }
    };

    fetchItemsByDate();
    return () => controller.abort();
  }, [token, getFreshApiToken]);

  // Fetch items-by-user (depends on timeFrame)
  useEffect(() => {
    const controller = new AbortController();

    const fetchItemsByUser = async () => {
      setItemsByUserLoading(true);
      setChartsError(null);

      if (!token) {
        setChartsError('Authentication token is missing.');
        setItemsByUserLoading(false);
        return;
      }

      try {
        const authToken = await getFreshApiToken('usage-report-items-by-user');
        const data = await apiService.get<ItemsByUserReportItem[]>(
          `/reports/items-by-user?timeFrame=${timeFrame}`,
          authToken,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setItemsByUser(data);
          setChartsError(null);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        if (err instanceof Error) {
          setChartsError(err.message);
        } else {
          setChartsError('An unknown error occurred when fetching chart data');
        }
      } finally {
        if (!controller.signal.aborted) {
          setItemsByUserLoading(false);
        }
      }
    };

    fetchItemsByUser();
    return () => controller.abort();
  }, [token, timeFrame, getFreshApiToken]);

  useEffect(() => {
    const controller = new AbortController();

    const fetchStoreWalkAudit = async () => {
      setStoreWalkAuditLoading(true);
      setStoreWalkAuditError(null);

      if (!token) {
        setStoreWalkAuditLoading(false);
        return;
      }

      try {
        const authToken = await getFreshApiToken('usage-report-store-walk-audit');
        const data = await apiService.get<StoreWalkAuditCycle[]>(
          '/reports/store-walk-audit',
          authToken,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setStoreWalkAudit(data);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setStoreWalkAuditError(
          err instanceof Error ? err.message : 'An unknown error occurred when fetching walk audit',
        );
      } finally {
        if (!controller.signal.aborted) {
          setStoreWalkAuditLoading(false);
        }
      }
    };

    fetchStoreWalkAudit();
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
          backgroundColor: semanticDataViz.series4,
          borderColor: semanticDataViz.series4,
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
          borderColor: semanticDataViz.series2,
          backgroundColor: semanticDataViz.series2,
          tension: 0.1,
        },
      ],
    }),
    [itemsByDate],
  );

  const barChartOptions = useMemo(
    () => ({
      responsive: true,
      plugins: {
        title: {
          display: true,
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
    [],
  );

  const lineChartOptions = useMemo(
    () => ({
      responsive: true,
      plugins: {
        title: {
          display: true,
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
    [],
  );

  if (loading) {
    return (
      <div className="container mx-auto p-4 text-center" role="status" aria-live="polite">
        Loading usage report…
      </div>
    );
  }

  if (usageError && !usageData) {
    return (
      <div className="container mx-auto p-4 text-center text-semantic-critical" role="alert">
        {usageError}
      </div>
    );
  }

  return (
    <main
      className="container mx-auto max-w-6xl space-y-7 p-4"
      aria-label="Usage reporting workspace"
    >
      <header className="max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="font-heading text-2xl font-semibold">Usage Report</h1>
        </div>
        <p className="mt-2 text-sm text-semantic-text-secondary">
          See which team members are adding stock, and review daily adds, edits, and removals over
          the last 90 days.
        </p>
      </header>
      {/* Chart Section */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Card role="region" aria-label="User contribution summary">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <CardTitle>
                <h2 className="text-xl font-semibold">Stock Added by Team Member</h2>
              </CardTitle>
              <Select value={timeFrame} onValueChange={setTimeFrame}>
                <SelectTrigger className="w-full sm:w-[180px]">
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
            ) : chartsError ? (
              <p className="text-semantic-critical text-sm" role="alert">
                {chartsError}
              </p>
            ) : itemsByUser && itemsByUser.length > 0 ? (
              <div className="space-y-4">
                <div className="aspect-[4/3] w-full sm:aspect-auto">
                  <Suspense
                    fallback={<div className="h-64 animate-pulse rounded bg-semantic-surface-3" />}
                  >
                    <Bar
                      data={itemsByUserChartData}
                      options={{
                        ...barChartOptions,
                        maintainAspectRatio: false,
                        plugins: {
                          ...barChartOptions.plugins,
                          title: {
                            display: true,
                            text: 'Items added per team member',
                          },
                        },
                      }}
                    />
                  </Suspense>
                </div>
                {/* Mobile row summary for Items by User */}
                <ul
                  className="space-y-3 sm:hidden"
                  aria-label="Mobile stock by team member summary"
                >
                  {itemsByUser.map((item) => (
                    <li
                      key={item.userId}
                      className="flex items-center justify-between rounded-md border bg-semantic-surface-2 p-3 text-sm"
                    >
                      <span className="font-medium text-semantic-text-primary">
                        {formatUserLabel(item)}
                      </span>
                      <span className="font-bold text-semantic-teal">
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
                          <TableCell className="text-right">
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

        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-xl font-semibold">Daily Stock Additions</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartsLoading ? (
              <div className="text-center py-8" role="status" aria-live="polite">
                Loading chart data…
              </div>
            ) : chartsError ? (
              <p className="text-semantic-critical text-sm" role="alert">
                {chartsError}
              </p>
            ) : itemsByDate && itemsByDate.length > 0 ? (
              <div className="space-y-4">
                <Suspense
                  fallback={<div className="h-64 animate-pulse rounded bg-semantic-surface-3" />}
                >
                  <Line
                    data={itemsByDateChartData}
                    options={{
                      ...lineChartOptions,
                      plugins: {
                        ...lineChartOptions.plugins,
                        title: {
                          display: true,
                          text: 'Stock additions over time',
                        },
                      },
                    }}
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
                        <TableCell className="text-right">
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

      <Card role="region" aria-label="Store walk audit">
        <CardHeader>
          <CardTitle>
            <h2 className="text-xl font-semibold">Store Walk Audit</h2>
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
                    <Table aria-label="Store walk productivity">
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
                          <p className="font-medium text-semantic-critical">
                            {formatAuditFlagType(flag.type)}
                          </p>
                          <p className="text-semantic-critical">{flag.userName}</p>
                          <p className="text-semantic-critical">{flag.message}</p>
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
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-xl font-semibold">Daily Activity — Last 90 Days</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {usageData && usageData.length > 0 ? (
            <>
              {/* Mobile daily activity summary */}
              <ul className="mb-5 space-y-3 md:hidden" aria-label="Mobile daily activity summary">
                {usageData.map((row) => (
                  <li
                    key={`${row.date}-${row.user_id}`}
                    className="rounded-lg border bg-semantic-surface-1 p-4"
                  >
                    <div className="flex items-center justify-between border-b pb-2 mb-3">
                      <span className="font-heading font-bold">{formatUsageDate(row.date)}</span>
                      <span className="text-xs text-semantic-text-secondary">{row.user_role}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded bg-semantic-success-muted p-2">
                        <p className="text-semantic-text-secondary">Items added</p>
                        <p className="text-lg font-bold text-semantic-success">
                          {numberFormatter.format(row.creations)}
                        </p>
                      </div>
                      <div className="rounded bg-semantic-warning-muted p-2">
                        <p className="text-semantic-text-secondary">Items edited</p>
                        <p className="text-lg font-bold text-semantic-warning">
                          {numberFormatter.format(row.updates)}
                        </p>
                      </div>
                      <div className="rounded bg-semantic-critical-muted p-2">
                        <p className="text-semantic-text-secondary">Items removed</p>
                        <p className="text-lg font-bold text-semantic-critical">
                          {numberFormatter.format(row.deletions)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="hidden md:block overflow-x-auto">
                <Table>
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
                        <TableCell>{row.user_id}</TableCell>
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
    </main>
  );
}
