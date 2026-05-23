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

const numberFormatter = new Intl.NumberFormat('en-AU');
const dateFormatter = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' });

function formatUsageDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not available' : dateFormatter.format(date);
}

function formatUserLabel(item: ItemsByUserReportItem) {
  return item.userName || `Unknown user ${item.userId}`;
}

export function UsageReportPage({ token }: UsageReportPageProps) {
  const [usageData, setUsageData] = useState<DailyUsageReportItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [itemsByUser, setItemsByUser] = useState<ItemsByUserReportItem[] | null>(null);
  const [itemsByDate, setItemsByDate] = useState<ItemsByDateReportItem[] | null>(null);
  const [chartsLoading, setChartsLoading] = useState(true);
  const [chartsError, setChartsError] = useState<string | null>(null);
  const [timeFrame, setTimeFrame] = useState('all-time');

  useEffect(() => {
    const controller = new AbortController();

    const fetchUsageData = async () => {
      if (!token) {
        setUsageError('Authentication token is missing.');
        setLoading(false);
        return;
      }

      try {
        const data = await apiService.get<DailyUsageReportItem[]>(
          '/reports/daily-usage',
          token,
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
  }, [token]);

  // Fetch items-by-date (independent of timeFrame)
  useEffect(() => {
    const controller = new AbortController();

    const fetchItemsByDate = async () => {
      if (!token) return;

      try {
        const data = await apiService.get<ItemsByDateReportItem[]>(
          '/reports/items-by-date',
          token,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setItemsByDate(data);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        if (err instanceof Error) {
          setChartsError(err.message);
        } else {
          setChartsError('An unknown error occurred when fetching chart data');
        }
      }
    };

    fetchItemsByDate();
    return () => controller.abort();
  }, [token]);

  // Fetch items-by-user (depends on timeFrame)
  useEffect(() => {
    const controller = new AbortController();

    const fetchItemsByUser = async () => {
      if (!token) {
        setChartsError('Authentication token is missing.');
        setChartsLoading(false);
        return;
      }

      try {
        const data = await apiService.get<ItemsByUserReportItem[]>(
          `/reports/items-by-user?timeFrame=${timeFrame}`,
          token,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setItemsByUser(data);
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
          setChartsLoading(false);
        }
      }
    };

    fetchItemsByUser();
    return () => controller.abort();
  }, [token, timeFrame]);

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
          <button
            onClick={() => window.print()}
            aria-label="Print this report"
            className="hidden md:flex items-center gap-2 rounded-md border border-semantic-primary px-3 py-1.5 text-sm font-medium text-semantic-primary hover:bg-semantic-primary/5 transition-colors no-print"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9V2h12v7" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print Report
          </button>
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
