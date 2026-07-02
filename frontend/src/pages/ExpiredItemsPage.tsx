import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import * as Sentry from '@sentry/react';
import { ExpiredItem } from '../types/inventory';
import { apiService } from '../lib/api.service';
import { getExpiredItems, processExpiredItem } from '../services/expiredItemService';
import ExpiredLossReport from '../components/ExpiredLossReport';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog';
import Toast from '../components/ui/toast';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
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
  ChartOptions,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const Bar = lazy(() => import('react-chartjs-2').then((m) => ({ default: m.Bar })));

interface ExpiredItemsPageProps {
  token: string | null;
}

interface LossBySkuReportItem {
  sku: string;
  productName: string;
  totalLoss: number;
  count: number;
}

interface LossByDepartmentReportItem {
  department: string;
  totalLoss: number;
  count: number;
}

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});

const dateFormatter = new Intl.DateTimeFormat('en-AU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function formatExpiry(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : dateFormatter.format(d);
}

const SKELETON_ROWS = Array.from({ length: 5 }, (_, i) => i);
const PROCESS_DIALOG_LABEL_CLASS = 'text-xs font-medium text-semantic-text-secondary';
const PROCESS_DIALOG_VALUE_CLASS = 'text-sm font-medium text-semantic-text-primary break-words';
const PROCESS_DIALOG_HELP_CLASS = 'mt-1 text-sm font-medium text-semantic-text-secondary';
const PROCESS_DIALOG_ERROR_CLASS = 'mt-1 text-sm font-medium text-semantic-critical';

// The number entered here is the physically-counted expired quantity, recorded
// at write-off time. It is intentionally NOT capped by `quantityAvailable`: the
// scan flow only logs a SKU + expiry marker (not real stock-on-hand), so the true
// expired count is only known now. See issue #268. We still require a whole number
// >= 1; the write-off ledger is the source of truth for the recorded loss.
function parseUnitsDiscardedInput(rawUnitsDiscarded: string): {
  value?: number;
  error: string | null;
} {
  const trimmed = rawUnitsDiscarded.trim();
  if (trimmed === '') {
    return { error: 'Must be at least 1' };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { error: 'Enter a whole number' };
  }

  const parsed = Number(trimmed);
  if (parsed < 1) {
    return { error: 'Must be at least 1' };
  }

  return { value: parsed, error: null };
}

const ExpiredItemsPage: React.FC<ExpiredItemsPageProps> = ({ token }) => {
  const getFreshApiToken = useFreshApiToken(token);
  const [expiredItems, setExpiredItems] = useState<ExpiredItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ExpiredItem | null>(null);
  const [action, setAction] = useState<'sold_through' | 'expired' | null>(null);
  const [unitsDiscarded, setUnitsDiscarded] = useState<string>('1');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
  } | null>(null);
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [lossBySkuData, setLossBySkuData] = useState<LossBySkuReportItem[] | null>(null);
  const [lossByDepartmentData, setLossByDepartmentData] = useState<
    LossByDepartmentReportItem[] | null
  >(null);
  const [chartsLoading, setChartsLoading] = useState(true);
  const [chartsError, setChartsError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [unitsDiscardedError, setUnitsDiscardedError] = useState<string | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Authentication token is missing.');
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    const fetchExpiredItems = async () => {
      try {
        setLoading(true);
        const authToken = await getFreshApiToken('expired-items-list');
        const data = await getExpiredItems(authToken || null, controller.signal);
        if (!controller.signal.aborted) {
          setExpiredItems(data);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError('Failed to fetch expired items');
        if (err instanceof Error) {
          Sentry.captureException(err, { tags: { feature: 'expired-items' } });
        } else {
          Sentry.captureMessage('Error fetching expired items', {
            level: 'error',
            tags: { feature: 'expired-items' },
          });
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchExpiredItems();
    return () => controller.abort();
  }, [token, getFreshApiToken]);

  const handleAction = useCallback((item: ExpiredItem, actionType: 'sold_through' | 'expired') => {
    setSelectedItem(item);
    setAction(actionType);
    setProcessError(null);
    setUnitsDiscardedError(null);
    setUnitsDiscarded(actionType === 'expired' ? '1' : '0');
    setIsModalOpen(true);
  }, []);

  const handleUnitsDiscardedChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawUnitsDiscarded = e.target.value;
      setUnitsDiscarded(rawUnitsDiscarded);
      setUnitsDiscardedError(parseUnitsDiscardedInput(rawUnitsDiscarded).error);
    },
    [],
  );

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setIsToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setIsToastVisible(false), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleProcessItem = useCallback(() => {
    if (!selectedItem || !action) return;

    setProcessError(null);
    setUnitsDiscardedError(null);

    if (action === 'expired') {
      const validation = parseUnitsDiscardedInput(unitsDiscarded);
      if (validation.error) {
        setUnitsDiscardedError(validation.error);
        return;
      }
    }

    setIsConfirmDialogOpen(true);
  }, [selectedItem, action, unitsDiscarded]);

  const confirmProcessItem = useCallback(async () => {
    if (!selectedItem || !action || isProcessing) return;

    setIsProcessing(true);
    setProcessError(null);

    try {
      const processUnitsDiscarded =
        action === 'expired' ? parseUnitsDiscardedInput(unitsDiscarded).value : undefined;
      if (action === 'expired' && processUnitsDiscarded === undefined) {
        setUnitsDiscardedError('Must be at least 1');
        setIsProcessing(false);
        return;
      }

      const authToken = await getFreshApiToken('expired-items-process');

      await processExpiredItem(
        {
          inventoryItemId: selectedItem.id,
          action,
          ...(action === 'expired' ? { unitsDiscarded: processUnitsDiscarded } : {}),
        },
        authToken || null,
      );

      const data = await getExpiredItems(authToken || null);
      setExpiredItems(data);

      const label = action === 'expired' ? 'Expired' : 'Sold Through';
      showToast(`Item marked as ${label} successfully.`, 'success');

      setIsModalOpen(false);
      setIsConfirmDialogOpen(false);
      setSelectedItem(null);
      setAction(null);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to process item. Please try again.';
      setProcessError(errorMessage);
      showToast(errorMessage, 'error');
      setIsConfirmDialogOpen(false);
      if (err instanceof Error) {
        Sentry.captureException(err, { tags: { feature: 'expired-items' } });
      } else {
        Sentry.captureMessage('Error processing expired item', {
          level: 'error',
          tags: { feature: 'expired-items' },
        });
      }
    } finally {
      setIsProcessing(false);
    }
  }, [selectedItem, action, unitsDiscarded, isProcessing, getFreshApiToken, showToast]);

  const retryControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      retryControllerRef.current?.abort();
    };
  }, []);

  const retryFetchItems = useCallback(async () => {
    if (!token) return;
    retryControllerRef.current?.abort();
    const controller = new AbortController();
    retryControllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const authToken = await getFreshApiToken('expired-items-retry');
      const data = await getExpiredItems(authToken || null, controller.signal);
      if (!controller.signal.aborted) {
        setExpiredItems(data);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof Error ? err.message : 'Failed to load expired items. Please try again.',
      );
      if (err instanceof Error) {
        Sentry.captureException(err, { tags: { feature: 'expired-items' } });
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [token, getFreshApiToken]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setIsConfirmDialogOpen(false);
    setSelectedItem(null);
    setAction(null);
    setProcessError(null);
    setUnitsDiscardedError(null);
  }, []);

  // Fetch chart data — failures here should NOT blank out the rest of the page.
  useEffect(() => {
    const controller = new AbortController();

    const fetchChartData = async () => {
      if (!token) {
        setChartsError('Authentication token is missing.');
        setChartsLoading(false);
        return;
      }

      try {
        const authToken = await getFreshApiToken('expired-items-loss-reports');
        const [lossBySkuResult, lossByDeptResult] = await Promise.allSettled([
          apiService.get<LossBySkuReportItem[]>(
            '/reports/loss-by-sku',
            authToken,
            controller.signal,
          ),
          apiService.get<LossByDepartmentReportItem[]>(
            '/reports/loss-by-department',
            authToken,
            controller.signal,
          ),
        ]);

        if (controller.signal.aborted) return;

        setLossBySkuData(
          lossBySkuResult.status === 'fulfilled' ? (lossBySkuResult.value ?? []) : [],
        );
        setLossByDepartmentData(
          lossByDeptResult.status === 'fulfilled' ? (lossByDeptResult.value ?? []) : [],
        );

        if (lossBySkuResult.status === 'rejected' && lossByDeptResult.status === 'rejected') {
          const reason =
            lossBySkuResult.reason instanceof Error
              ? lossBySkuResult.reason.message
              : 'Could not load loss reports';
          setChartsError(reason);
        } else {
          setChartsError(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setChartsLoading(false);
        }
      }
    };

    fetchChartData();
    return () => controller.abort();
  }, [token, getFreshApiToken]);

  const lossBySkuChartData = useMemo(
    () => ({
      labels: lossBySkuData?.map((item) => item.sku) ?? [],
      datasets: [
        {
          label: 'Total Loss ($)',
          data: lossBySkuData?.map((item) => item.totalLoss) ?? [],
          backgroundColor: 'rgba(239, 68, 68, 0.5)',
          borderColor: 'rgba(239, 68, 68, 1)',
          borderWidth: 1,
        },
      ],
    }),
    [lossBySkuData],
  );

  const lossByDepartmentChartData = useMemo(
    () => ({
      labels: lossByDepartmentData?.map((item) => item.department) ?? [],
      datasets: [
        {
          label: 'Total Loss ($)',
          data: lossByDepartmentData?.map((item) => item.totalLoss) ?? [],
          backgroundColor: 'rgba(59, 130, 246, 0.5)',
          borderColor: 'rgba(59, 130, 246, 1)',
          borderWidth: 1,
        },
      ],
    }),
    [lossByDepartmentData],
  );

  const chartOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      plugins: {
        title: { display: true },
        legend: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => {
              const num = typeof value === 'number' ? value : Number(value);
              return Number.isFinite(num) ? `$${num}` : `${value}`;
            },
          },
        },
      },
    }),
    [],
  );

  const skuChartOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      ...chartOptions,
      plugins: {
        ...chartOptions.plugins,
        title: { display: true, text: 'Top SKUs by Total Loss Value' },
      },
    }),
    [chartOptions],
  );

  const deptChartOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      ...chartOptions,
      plugins: {
        ...chartOptions.plugins,
        title: { display: true, text: 'Losses by Department' },
      },
    }),
    [chartOptions],
  );

  if (loading) {
    return (
      <div
        className="container mx-auto px-4 py-8"
        role="status"
        aria-live="polite"
        aria-label="Loading expired items"
      >
        <div className="mb-6">
          <div className="h-8 w-48 rounded-md bg-semantic-surface-3 animate-pulse" />
          <div className="mt-2 h-4 w-80 rounded bg-semantic-surface-3 animate-pulse" />
        </div>
        <div className="rounded-md border overflow-hidden">
          {SKELETON_ROWS.map((i) => (
            <div key={i} className="flex gap-4 px-4 py-3 border-b last:border-0">
              <div className="h-4 w-20 rounded bg-semantic-surface-3 animate-pulse" />
              <div className="h-4 w-40 rounded bg-semantic-surface-3 animate-pulse" />
              <div className="h-4 w-28 rounded bg-semantic-surface-3 animate-pulse" />
              <div className="h-4 w-24 rounded bg-semantic-surface-3 animate-pulse ml-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-semantic-critical font-medium">{error}</p>
          <button
            onClick={retryFetchItems}
            className="rounded-md border border-semantic-primary px-4 py-2 text-sm font-medium text-semantic-primary hover:bg-semantic-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-semantic-primary transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold font-heading">Expired Items</h1>
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
        <p className="mt-2 text-sm text-semantic-text-secondary max-w-2xl">
          Review and process stock that has reached its expiry date. Processed items are moved to
          loss reports.
        </p>
      </header>

      {expiredItems.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <p className="text-semantic-text-secondary text-sm">No expired items found.</p>
          <p className="text-semantic-text-tertiary text-xs max-w-xs">
            Items that have reached their expiry date will appear here for processing.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile row summary */}
          <ul className="mb-5 space-y-3 lg:hidden" aria-label="Expired items">
            {expiredItems.slice(0, 50).map((item) => (
              <li key={item.id} className="rounded-lg border bg-semantic-surface-1 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-medium">{item.productName}</p>
                    <p className="mt-1 text-sm text-semantic-text-secondary">
                      <span className="font-mono">{item.sku}</span> · {item.locationName}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md bg-semantic-critical-muted px-2 py-1 text-xs font-medium text-semantic-critical">
                    {item.status}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-semantic-text-secondary">Expiry</dt>
                    <dd className="font-medium tabular-nums">{formatExpiry(item.expiryDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-semantic-text-secondary">Available</dt>
                    <dd className="font-medium tabular-nums">{item.quantityAvailable}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex gap-2">
                  <Button
                    onClick={() => handleAction(item, 'sold_through')}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={isProcessing}
                  >
                    Sold Through
                  </Button>
                  <Button
                    onClick={() => handleAction(item, 'expired')}
                    variant="outline"
                    size="sm"
                    className="flex-1 text-semantic-critical border-semantic-critical hover:bg-semantic-critical/10"
                    disabled={isProcessing}
                  >
                    Expired
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden lg:block overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-semantic-surface-2 hover:bg-semantic-surface-2">
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    SKU
                  </TableHead>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    Product Name
                  </TableHead>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    Location
                  </TableHead>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    Expiry Date
                  </TableHead>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    Cost Price
                  </TableHead>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    Qty
                  </TableHead>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    Status
                  </TableHead>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expiredItems.map((item) => (
                  <TableRow
                    key={item.id}
                    className="hover:bg-semantic-surface-2/50 transition-colors"
                  >
                    <TableCell className="whitespace-nowrap text-sm text-semantic-text-primary">
                      {item.sku}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm font-medium text-semantic-text-primary">
                      {item.productName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-semantic-text-secondary">
                      {item.locationName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums text-semantic-text-primary">
                      {formatExpiry(item.expiryDate)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-semantic-text-primary">
                      {currencyFormatter.format(item.costPrice)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-semantic-text-primary">
                      {item.quantityAvailable}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm font-medium text-semantic-critical">
                      {item.status}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleAction(item, 'sold_through')}
                          variant="outline"
                          size="sm"
                          disabled={isProcessing}
                        >
                          Sold Through
                        </Button>
                        <Button
                          onClick={() => handleAction(item, 'expired')}
                          variant="outline"
                          size="sm"
                          className="text-semantic-critical border-semantic-critical hover:bg-semantic-critical/10"
                          disabled={isProcessing}
                        >
                          Expired
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Chart Section */}
      {chartsError && (
        <div
          className="mt-6 p-3 rounded-md bg-destructive/10 text-destructive text-sm"
          role="alert"
        >
          {chartsError}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 mt-8">
        <Card>
          <CardHeader>
            <CardTitle>Worst Loss by SKU</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="min-h-[12rem]">
              {chartsLoading ? (
                <div className="space-y-2 py-2" role="status" aria-label="Loading chart">
                  <div className="h-4 w-3/4 rounded bg-semantic-surface-3 animate-pulse" />
                  <div className="h-32 w-full rounded bg-semantic-surface-3 animate-pulse" />
                  <div className="h-4 w-1/2 rounded bg-semantic-surface-3 animate-pulse" />
                </div>
              ) : lossBySkuData && lossBySkuData.length > 0 ? (
                <Suspense
                  fallback={
                    <div className="h-48 w-full rounded bg-semantic-surface-3 animate-pulse" />
                  }
                >
                  <Bar data={lossBySkuChartData} options={skuChartOptions} />
                </Suspense>
              ) : (
                <div className="py-8 text-center text-sm text-semantic-text-tertiary">
                  No loss data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Worst Loss by Department</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="min-h-[12rem]">
              {chartsLoading ? (
                <div className="space-y-2 py-2" role="status" aria-label="Loading chart">
                  <div className="h-4 w-3/4 rounded bg-semantic-surface-3 animate-pulse" />
                  <div className="h-32 w-full rounded bg-semantic-surface-3 animate-pulse" />
                  <div className="h-4 w-1/2 rounded bg-semantic-surface-3 animate-pulse" />
                </div>
              ) : lossByDepartmentData && lossByDepartmentData.length > 0 ? (
                <Suspense
                  fallback={
                    <div className="h-48 w-full rounded bg-semantic-surface-3 animate-pulse" />
                  }
                >
                  <Bar data={lossByDepartmentChartData} options={deptChartOptions} />
                </Suspense>
              ) : (
                <div className="py-8 text-center text-sm text-semantic-text-tertiary">
                  No department loss data available
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Process Expired Item Dialog */}
      <Dialog
        open={isModalOpen && !!selectedItem && !!action}
        onOpenChange={(open) => !open && closeModal()}
      >
        {selectedItem && action && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Process Expired Item</DialogTitle>
              <DialogDescription>
                Review item details and choose the quantity to process.
              </DialogDescription>
            </DialogHeader>
            <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="col-span-2">
                <dt className={PROCESS_DIALOG_LABEL_CLASS}>Product</dt>
                <dd className={PROCESS_DIALOG_VALUE_CLASS}>{selectedItem.productName}</dd>
              </div>
              <div>
                <dt className={PROCESS_DIALOG_LABEL_CLASS}>SKU</dt>
                <dd className={PROCESS_DIALOG_VALUE_CLASS}>{selectedItem.sku}</dd>
              </div>
              <div>
                <dt className={PROCESS_DIALOG_LABEL_CLASS}>Location</dt>
                <dd className={PROCESS_DIALOG_VALUE_CLASS}>{selectedItem.locationName}</dd>
              </div>
              <div>
                <dt className={PROCESS_DIALOG_LABEL_CLASS}>Expiry Date</dt>
                <dd className={PROCESS_DIALOG_VALUE_CLASS}>
                  {formatExpiry(selectedItem.expiryDate)}
                </dd>
              </div>
              <div>
                <dt className={PROCESS_DIALOG_LABEL_CLASS}>Cost Price</dt>
                <dd className={PROCESS_DIALOG_VALUE_CLASS}>
                  {currencyFormatter.format(selectedItem.costPrice)}
                </dd>
              </div>
            </dl>

            {action === 'expired' && (
              <div className="mb-4">
                <Label htmlFor="units-discarded" className="mb-1 block">
                  Units to Discard
                </Label>
                <Input
                  id="units-discarded"
                  type="number"
                  min="1"
                  step="1"
                  value={unitsDiscarded}
                  onChange={handleUnitsDiscardedChange}
                  aria-describedby="units-hint units-error"
                  aria-invalid={!!unitsDiscardedError}
                />
                <p id="units-hint" className={PROCESS_DIALOG_HELP_CLASS}>
                  Enter the total number of expired units to write off.
                </p>
                {unitsDiscardedError && (
                  <p id="units-error" className={PROCESS_DIALOG_ERROR_CLASS} role="alert">
                    {unitsDiscardedError}
                  </p>
                )}
              </div>
            )}

            {processError && (
              <div className="mb-4 p-3 bg-semantic-critical-muted text-semantic-critical rounded-md border border-semantic-critical/20">
                {processError}
              </div>
            )}

            <DialogFooter className="mt-6">
              <Button variant="outline" onClick={closeModal} disabled={isProcessing}>
                Cancel
              </Button>
              <Button
                onClick={handleProcessItem}
                disabled={isProcessing || !!unitsDiscardedError}
                className={
                  action === 'expired' ? 'bg-semantic-critical hover:bg-semantic-critical/90' : ''
                }
              >
                {action === 'expired' ? 'Mark Expired' : 'Mark Sold Through'}
              </Button>
            </DialogFooter>

            <AlertDialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm Action</AlertDialogTitle>
                  <AlertDialogDescription>
                    {action === 'expired'
                      ? `Confirm writing off ${unitsDiscarded} units for ${currencyFormatter.format(
                          (parseUnitsDiscardedInput(unitsDiscarded).value ?? 0) *
                            selectedItem.costPrice,
                        )} loss. This action cannot be undone.`
                      : 'Confirm marking this item as sold through. This action cannot be undone.'}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    onClick={() => {
                      setIsConfirmDialogOpen(false);
                      setIsModalOpen(true); // Reopen the main modal if user cancels
                    }}
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={confirmProcessItem} disabled={isProcessing}>
                    {isProcessing ? 'Processing…' : 'Confirm'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </DialogContent>
        )}
      </Dialog>

      {/* Expired Losses Report Section */}
      <div className="mt-12">
        <ExpiredLossReport token={token} />
      </div>

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          isVisible={isToastVisible}
          onClose={() => setIsToastVisible(false)}
        />
      )}
    </div>
  );
};

export default ExpiredItemsPage;
