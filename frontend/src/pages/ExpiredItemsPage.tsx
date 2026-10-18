import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as Sentry from '@sentry/react';
import { ExpiredItem } from '../types/inventory';
import { apiService } from '../lib/api.service';
import { getExpiredItems, processExpiredItem } from '../services/expiredItemService';
import ExpiredLossReport from '../components/ExpiredLossReport';
import Toast from '../components/ui/toast';
import { useFreshApiToken } from '../hooks/useFreshApiToken';
import { semanticDataViz } from '../theme/semantic-tokens';
import {
  ChartsErrorBanner,
  ExpiredItemsEmptyState,
  ExpiredItemsPhoneList,
  ExpiredItemsTables,
  LossChartCard,
  PageHeader,
  PageLoadError,
  PageLoadingSkeleton,
  ProcessItemDialog,
  currencyFormatter,
  parseUnitsDiscardedInput,
} from '../components/expired-items/ExpiredItemsParts';

// Type-only import — no runtime cost. Chart.js itself is loaded on demand via the
// shared lazy chart module (registration lives inside that lazily-loaded chunk).
import type { ChartOptions } from 'chart.js';

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

const axisCurrencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

function buildLossChartData(labels: string[], values: number[], color: string) {
  return {
    labels,
    datasets: [
      {
        label: 'Total Loss ($)',
        data: values,
        backgroundColor: color,
        borderColor: color,
        borderWidth: 1,
      },
    ],
  };
}

function buildChartLabel(subject: string, rows: Array<{ name: string; totalLoss: number }>) {
  return `Bar chart of total loss by ${subject}: ${rows
    .map((row) => `${row.name} ${currencyFormatter.format(row.totalLoss)}`)
    .join(', ')}`;
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: guard state when the auth prerequisite is absent
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

  const handleUnitsDiscardedChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawUnitsDiscarded = e.target.value;
    setUnitsDiscarded(rawUnitsDiscarded);
    setUnitsDiscardedError(parseUnitsDiscardedInput(rawUnitsDiscarded).error);
  }, []);

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
    () =>
      buildLossChartData(
        (lossBySkuData ?? []).map((item) => item.sku),
        (lossBySkuData ?? []).map((item) => item.totalLoss),
        semanticDataViz.series5,
      ),
    [lossBySkuData],
  );

  const lossByDepartmentChartData = useMemo(
    () =>
      buildLossChartData(
        (lossByDepartmentData ?? []).map((item) => item.department),
        (lossByDepartmentData ?? []).map((item) => item.totalLoss),
        semanticDataViz.series2,
      ),
    [lossByDepartmentData],
  );

  const lossBySkuChartLabel = useMemo(
    () =>
      buildChartLabel(
        'SKU',
        (lossBySkuData ?? []).map((item) => ({ name: item.sku, totalLoss: item.totalLoss })),
      ),
    [lossBySkuData],
  );

  const lossByDepartmentChartLabel = useMemo(
    () =>
      buildChartLabel(
        'department',
        (lossByDepartmentData ?? []).map((item) => ({
          name: item.department,
          totalLoss: item.totalLoss,
        })),
      ),
    [lossByDepartmentData],
  );

  const chartOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      plugins: {
        // The card heading already names each chart; a canvas title would repeat it.
        title: { display: false },
        legend: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => {
              const num = typeof value === 'number' ? value : Number(value);
              return Number.isFinite(num) ? axisCurrencyFormatter.format(num) : `${value}`;
            },
          },
        },
      },
    }),
    [],
  );

  const cancelConfirm = useCallback(() => {
    setIsConfirmDialogOpen(false);
    setIsModalOpen(true); // Reopen the main modal if user cancels
  }, []);

  if (loading) {
    return <PageLoadingSkeleton />;
  }

  if (error) {
    return <PageLoadError error={error} onRetry={retryFetchItems} />;
  }

  return (
    <section className="print-report-root py-8" aria-labelledby="expired-items-heading">
      <PageHeader />

      {expiredItems.length === 0 ? (
        <ExpiredItemsEmptyState />
      ) : (
        <>
          <ExpiredItemsPhoneList
            items={expiredItems}
            isProcessing={isProcessing}
            onAction={handleAction}
          />
          <ExpiredItemsTables
            items={expiredItems}
            isProcessing={isProcessing}
            onAction={handleAction}
          />
        </>
      )}

      <ChartsErrorBanner error={chartsError} />
      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 mt-8" aria-label="Loss charts">
        <LossChartCard
          title="5 Worst Performing SKUs"
          loading={chartsLoading}
          loadingLabel="Loading SKU loss chart"
          emptyText="No loss data available"
          chartLabel={lossBySkuChartLabel}
          data={lossBySkuChartData}
          options={chartOptions}
        />
        <LossChartCard
          title="5 Worst Performing Departments"
          loading={chartsLoading}
          loadingLabel="Loading department loss chart"
          emptyText="No department loss data available"
          chartLabel={lossByDepartmentChartLabel}
          data={lossByDepartmentChartData}
          options={chartOptions}
        />
      </section>

      <ProcessItemDialog
        open={isModalOpen}
        item={selectedItem}
        action={action}
        unitsDiscarded={unitsDiscarded}
        unitsDiscardedError={unitsDiscardedError}
        processError={processError}
        isProcessing={isProcessing}
        isConfirmOpen={isConfirmDialogOpen}
        onUnitsChange={handleUnitsDiscardedChange}
        onClose={closeModal}
        onSubmit={handleProcessItem}
        onConfirm={confirmProcessItem}
        onConfirmOpenChange={setIsConfirmDialogOpen}
        onConfirmCancel={cancelConfirm}
      />

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
    </section>
  );
};

export default ExpiredItemsPage;
