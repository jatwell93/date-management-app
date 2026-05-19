import React, { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { useNavigate } from 'react-router-dom';
import { ExpiredItem } from '../types/inventory';
import { apiService } from '../lib/api.service';
import { getExpiredItems, processExpiredItem } from '../services/expiredItemService';
import ExpiredLossReport from '../components/ExpiredLossReport';
import { Button } from '../components/ui/button';
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

// Import Chart.js components
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
import { Bar } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

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

const ExpiredItemsPage: React.FC<ExpiredItemsPageProps> = ({ token }) => {
  const [expiredItems, setExpiredItems] = useState<ExpiredItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<ExpiredItem | null>(null);
  const [action, setAction] = useState<'sold_through' | 'expired' | null>(null);
  const [unitsDiscarded, setUnitsDiscarded] = useState<number>(1);
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

  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      // If no token is available, redirect to login
      navigate('/login');
      return;
    }

    const fetchExpiredItems = async () => {
      try {
        setLoading(true);
        const data = await getExpiredItems(token);
        setExpiredItems(data);
      } catch (err) {
        setError('Failed to fetch expired items');
        if (err instanceof Error) {
          Sentry.captureException(err, {
            tags: { feature: 'expired-items' },
          });
        } else {
          Sentry.captureMessage('Error fetching expired items', {
            level: 'error',
            tags: { feature: 'expired-items' },
          });
        }
      } finally {
        setLoading(false);
      }
    };

    fetchExpiredItems();
  }, [token, navigate]);

  const handleAction = (item: ExpiredItem, action: 'sold_through' | 'expired') => {
    setSelectedItem(item);
    setAction(action);

    // If action is 'expired', we need to enter units discarded
    if (action === 'expired') {
      setUnitsDiscarded(1); // Default to 1
    } else {
      setUnitsDiscarded(0);
    }

    setIsModalOpen(true);
  };

  const showSuccessToast = (message: string) => {
    setToast({ message, type: 'success' });
    setIsToastVisible(true);
    setTimeout(() => setIsToastVisible(false), 3000);
  };

  const showErrorToast = (message: string) => {
    setToast({ message, type: 'error' });
    setIsToastVisible(true);
    setTimeout(() => setIsToastVisible(false), 3000);
  };

  const handleProcessItem = async () => {
    if (!selectedItem || !action) return;

    try {
      setProcessError(null);

      if (action === 'expired' && (!unitsDiscarded || unitsDiscarded <= 0)) {
        setProcessError('Units discarded must be a positive number when marking as expired');
        return;
      }

      // Show confirmation dialog before processing
      setIsConfirmDialogOpen(true);
    } catch (err) {
      setProcessError('Failed to process expired item');
      if (err instanceof Error) {
        Sentry.captureException(err, {
          tags: { feature: 'expired-items' },
        });
      } else {
        Sentry.captureMessage('Error processing expired item', {
          level: 'error',
          tags: { feature: 'expired-items' },
        });
      }
    }
  };

  const confirmProcessItem = async () => {
    if (!selectedItem || !action) return;

    try {
      setProcessError(null);

      const processUnitsDiscarded = action === 'expired' ? unitsDiscarded : 0;

      await processExpiredItem(
        {
          inventoryItemId: selectedItem.id,
          action,
          unitsDiscarded: processUnitsDiscarded,
        },
        token,
      );

      // Refresh the expired items list after successful processing
      const data = await getExpiredItems(token);
      setExpiredItems(data);

      // Show success message
      showSuccessToast(`Item marked as ${action} successfully!`);

      // Close both modals and reset state
      setIsModalOpen(false);
      setIsConfirmDialogOpen(false);
      setSelectedItem(null);
      setAction(null);
    } catch (err) {
      const errorMessage = 'Failed to process expired item';
      setProcessError(errorMessage);
      showErrorToast(errorMessage);
      if (err instanceof Error) {
        Sentry.captureException(err, {
          tags: { feature: 'expired-items' },
        });
      } else {
        Sentry.captureMessage('Error processing expired item', {
          level: 'error',
          tags: { feature: 'expired-items' },
        });
      }
    } finally {
      setIsConfirmDialogOpen(false);
    }
  };

  // Fetch chart data — failures here should NOT blank out the rest of the page.
  useEffect(() => {
    const fetchChartData = async () => {
      if (!token) {
        setChartsError('Authentication token is missing.');
        setChartsLoading(false);
        return;
      }

      try {
        // Fetch both chart datasets concurrently. Tolerate per-chart failure.
        const [lossBySkuResult, lossByDeptResult] = await Promise.allSettled([
          apiService.get<LossBySkuReportItem[]>('/reports/loss-by-sku', token),
          apiService.get<LossByDepartmentReportItem[]>('/reports/loss-by-department', token),
        ]);

        if (lossBySkuResult.status === 'fulfilled') {
          setLossBySkuData(lossBySkuResult.value ?? []);
        } else {
          setLossBySkuData([]);
        }

        if (lossByDeptResult.status === 'fulfilled') {
          setLossByDepartmentData(lossByDeptResult.value ?? []);
        } else {
          setLossByDepartmentData([]);
        }

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
        setChartsLoading(false);
      }
    };

    fetchChartData();
  }, [token]);

  // Prepare chart data for Loss by SKU
  const lossBySkuChartData = {
    labels: lossBySkuData?.map((item) => item.sku) || [],
    datasets: [
      {
        label: 'Total Loss ($)',
        data: lossBySkuData?.map((item) => item.totalLoss) || [],
        backgroundColor: 'rgba(239, 68, 68, 0.5)', // Red for losses
        borderColor: 'rgba(239, 68, 68, 1)',
        borderWidth: 1,
      },
    ],
  };

  // Prepare chart data for Loss by Department
  const lossByDepartmentChartData = {
    labels: lossByDepartmentData?.map((item) => item.department) || [],
    datasets: [
      {
        label: 'Total Loss ($)',
        data: lossByDepartmentData?.map((item) => item.totalLoss) || [],
        backgroundColor: 'rgba(59, 130, 246, 0.5)', // Blue
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1,
      },
    ],
  };

  // FIXED: properly formed chart options with ticks callback and balanced braces
  const chartOptions: ChartOptions<'bar'> = {
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
        ticks: {
          // format tick values as dollar amounts
          callback: (value) => {
            // Chart.js may pass objects for tick objects; coerce to number when possible
            const num = typeof value === 'number' ? value : Number(value);
            if (Number.isFinite(num)) {
              return `$${num}`;
            }
            return `${value}`;
          },
        },
      },
    },
  };

  if (loading) {
    return <div className="text-center py-10">Loading expired items…</div>;
  }

  if (error) {
    return <div className="text-center py-10 text-semantic-critical">{error}</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-semibold font-heading mb-6">Expired Items</h1>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
              SKU
            </TableHead>
            <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
              Product Name
            </TableHead>
            <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
              Location
            </TableHead>
            <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
              Expiry Date
            </TableHead>
            <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
              Cost Price
            </TableHead>
            <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
              Quantity Available
            </TableHead>
            <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
              Status
            </TableHead>
            <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {expiredItems.map((item) => (
            <TableRow key={item.id} className="hover:bg-muted/50">
              <TableCell className="whitespace-nowrap text-sm text-foreground">
                {item.sku}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm font-medium text-foreground">
                {item.productName}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-foreground">
                {item.locationName}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-foreground">
                {item.expiryDate}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-foreground">
                ${item.costPrice.toFixed(2)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-foreground">
                {item.quantityAvailable}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-foreground">
                {item.status}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm">
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleAction(item, 'sold_through')}
                    variant="outline"
                    size="sm"
                  >
                    Mark as Sold Through
                  </Button>
                  <Button
                    onClick={() => handleAction(item, 'expired')}
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive hover:bg-destructive/10"
                  >
                    Mark as Expired
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {expiredItems.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">No expired items found.</div>
      )}

      {/* Chart Section */}
      {chartsError && (
        <div className="mt-6 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          {chartsError}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-center">Worst Loss by SKU</CardTitle>
          </CardHeader>
          <CardContent>
            {chartsLoading ? (
              <div className="text-center py-8">Loading chart data…</div>
            ) : lossBySkuData && lossBySkuData.length > 0 ? (
              <Bar
                data={lossBySkuChartData}
                options={{
                  ...chartOptions,
                  plugins: {
                    ...chartOptions.plugins,
                    title: {
                      display: true,
                      text: 'Top SKUs by Total Loss Value',
                    },
                  },
                }}
              />
            ) : (
              <div className="text-center py-4 text-semantic-text-tertiary">
                No loss data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">Worst Loss by Department</CardTitle>
          </CardHeader>
          <CardContent>
            {chartsLoading ? (
              <div className="text-center py-8">Loading chart data…</div>
            ) : lossByDepartmentData && lossByDepartmentData.length > 0 ? (
              <Bar
                data={lossByDepartmentChartData}
                options={{
                  ...chartOptions,
                  plugins: {
                    ...chartOptions.plugins,
                    title: {
                      display: true,
                      text: 'Losses by Department',
                    },
                  },
                }}
              />
            ) : (
              <div className="text-center py-4 text-semantic-text-tertiary">
                No department loss data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Process Expired Item Dialog */}
      {isModalOpen && selectedItem && action && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <button
            type="button"
            aria-label="Close process expired item dialog"
            className="fixed inset-0 bg-semantic-canvas/50 backdrop-blur-sm"
            onClick={() => {
              setIsModalOpen(false);
              setSelectedItem(null);
              setAction(null);
            }}
          />
          <div className="relative z-10 bg-background rounded-lg shadow-lg w-11/12 max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold font-heading text-foreground">
                Process Expired Item
              </h3>
              <button
                onClick={() => {
                  setIsModalOpen(false);
                  setSelectedItem(null);
                  setAction(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <span className="text-2xl">&times;</span>
              </button>
            </div>

            <div className="mb-4 space-y-2">
              <p className="text-sm">
                <span className="font-semibold text-foreground">Product:</span>{' '}
                {selectedItem.productName}
              </p>
              <p className="text-sm">
                <span className="font-semibold text-foreground">SKU:</span> {selectedItem.sku}
              </p>
              <p className="text-sm">
                <span className="font-semibold text-foreground">Location:</span>{' '}
                {selectedItem.locationName}
              </p>
              <p className="text-sm">
                <span className="font-semibold text-foreground">Expiry Date:</span>{' '}
                {selectedItem.expiryDate}
              </p>
            </div>

            {action === 'expired' && (
              <div className="mb-4">
                <label
                  htmlFor="units-discarded"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Units to Discard
                </label>
                <input
                  id="units-discarded"
                  type="number"
                  min="1"
                  max={selectedItem.quantityAvailable}
                  value={unitsDiscarded}
                  onChange={(e) => setUnitsDiscarded(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Maximum available: {selectedItem.quantityAvailable}
                </p>
              </div>
            )}

            {processError && (
              <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md">
                {processError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsModalOpen(false);
                  setSelectedItem(null);
                  setAction(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleProcessItem}
                className={action === 'expired' ? 'bg-destructive hover:bg-destructive/90' : ''}
              >
                Confirm {action === 'expired' ? 'Expired' : 'Sold Through'}
              </Button>
            </div>

            <AlertDialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm Action</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to mark this item as {action}? This action cannot be
                    undone.
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
                  <AlertDialogAction onClick={confirmProcessItem}>Continue</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

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
