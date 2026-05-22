import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { buttonVariants } from '../components/ui/button';
import { apiService } from '../lib/api.service';

interface DashboardPageProps {
  token: string | null;
}

interface DashboardStats {
  totalProducts: number;
  totalInventoryItems: number;
  expiringItems: number;
  lowStockItems: number;
}

interface DashboardActivityEntry {
  id: number;
  description: string;
  timestamp: string;
}

// The Workers API (GET /api/dashboard) returns `{ stats: DashboardStats }`.
// Older versions of this page expected a flat object with
// `expiringSoon`/`markdownItems`/`recentActivity` — that shape is no longer
// produced by the backend and tried to call `.map` on an undefined
// `recentActivity`, which threw and left the user stuck on the generic
// ErrorBoundary fallback with nothing in the console.
interface DashboardResponse {
  stats: DashboardStats;
  recentActivity?: DashboardActivityEntry[];
}

const dashboardCountFormatter = new Intl.NumberFormat('en-AU');
const activityTimestampFormatter = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDashboardCount(value: number | undefined): string {
  return dashboardCountFormatter.format(value ?? 0);
}

function parseActivityTimestamp(timestamp: string): Date | null {
  const activityDate = new Date(timestamp);

  if (Number.isNaN(activityDate.getTime())) {
    return null;
  }

  return activityDate;
}

function formatActivityTimestamp(activityDate: Date): string {
  return activityTimestampFormatter.format(activityDate);
}

export function DashboardPage({ token }: DashboardPageProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<DashboardActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!token) {
        setError('Authentication token is missing.');
        setLoading(false);
        return;
      }

      try {
        const data = await apiService.get<DashboardResponse>('/dashboard', token);
        setStats(data?.stats ?? null);
        setRecentActivity(Array.isArray(data?.recentActivity) ? data.recentActivity : []);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [token]);

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="container mx-auto p-4 text-center text-sm font-medium text-semantic-text-secondary"
      >
        Loading pharmacy dashboard…
      </div>
    );
  }

  if (error) {
    return (
      <section
        role="alert"
        aria-labelledby="dashboard-error-heading"
        className="container mx-auto p-4 text-center text-semantic-critical"
      >
        <h1 id="dashboard-error-heading" className="font-heading text-2xl font-semibold">
          Dashboard unavailable
        </h1>
        <p className="mt-2 text-sm">{error}</p>
      </section>
    );
  }

  const expiringItems = stats?.expiringItems ?? 0;
  const lowStockItems = stats?.lowStockItems ?? 0;
  const attentionItems = expiringItems + lowStockItems;

  return (
    <section
      className="container mx-auto space-y-5 px-3 pb-6 pt-3 sm:space-y-6 sm:px-4 sm:pt-4 lg:px-6"
      aria-labelledby="dashboard-heading"
    >
      <div>
        <h1 id="dashboard-heading" className="font-heading text-2xl font-semibold">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-semantic-text-secondary">
          Review expiring stock and low stock before the next order.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.45fr)_minmax(240px,0.85fr)] md:items-start lg:gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <Card
          role="region"
          aria-labelledby="dashboard-attention-heading"
          className="gap-4 py-4 sm:gap-6 sm:py-6 md:row-span-2"
        >
          <CardHeader className="px-4 sm:px-6">
            <CardTitle>
              <h2 id="dashboard-attention-heading">Needs attention</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-4 sm:space-y-6 sm:px-6">
            <p className="max-w-prose text-sm text-semantic-text-secondary">
              {formatDashboardCount(attentionItems)} items need a stock decision.
            </p>

            <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-1 xl:grid-cols-2">
              <div className="rounded-md border border-semantic-warning/20 bg-semantic-warning-muted p-3 sm:p-4">
                <h3 id="dashboard-expiring-soon-heading" className="text-sm font-semibold">
                  Expiring soon
                </h3>
                <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-semantic-warning sm:mt-2 sm:text-3xl">
                  {formatDashboardCount(expiringItems)}
                </p>
                <p className="mt-1 text-xs text-semantic-warning-muted-foreground">
                  Use the expiry report to plan markdowns.
                </p>
              </div>

              <div className="rounded-md border border-semantic-critical/20 bg-semantic-critical-muted p-3 sm:p-4">
                <h3 id="dashboard-low-stock-heading" className="text-sm font-semibold">
                  Low stock
                </h3>
                <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-semantic-critical sm:mt-2 sm:text-3xl">
                  {formatDashboardCount(lowStockItems)}
                </p>
                <p className="mt-1 text-xs text-semantic-critical-muted-foreground">
                  Check whether these items need reordering.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href="/detailed-expiry-report"
                aria-label="Open expiry report"
                className={`${buttonVariants({ variant: 'default', size: 'sm' })} dashboard-action-link min-h-11 min-w-0 basis-0 flex-1 sm:min-h-10 sm:flex-none sm:basis-auto`}
              >
                <span className="sm:hidden">Expiry report</span>
                <span className="hidden sm:inline">Open expiry report</span>
              </a>
              <a
                href="/expired-items"
                aria-label="View expired items"
                className={`${buttonVariants({ variant: 'outline', size: 'sm' })} dashboard-action-link min-h-11 min-w-0 basis-0 flex-1 sm:min-h-10 sm:flex-none sm:basis-auto`}
              >
                <span className="sm:hidden">Expired items</span>
                <span className="hidden sm:inline">View expired items</span>
              </a>
            </div>
          </CardContent>
        </Card>

        <Card
          role="region"
          aria-labelledby="dashboard-stock-base-heading"
          className="gap-4 py-4 sm:gap-6 sm:py-6"
        >
          <CardHeader className="px-4 sm:px-6">
            <CardTitle>
              <h2 id="dashboard-stock-base-heading">Inventory covered</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-4 sm:px-6">
            <p className="text-sm text-semantic-text-secondary">
              {formatDashboardCount(stats?.totalProducts)} products with{' '}
              {formatDashboardCount(stats?.totalInventoryItems)} inventory records
            </p>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-1 xl:grid-cols-2">
              <div className="min-w-0">
                <dt
                  id="dashboard-total-products-heading"
                  className="text-xs text-semantic-text-tertiary"
                >
                  Total products
                </dt>
                <dd className="mt-1 font-heading text-2xl font-bold tabular-nums">
                  {formatDashboardCount(stats?.totalProducts)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt
                  id="dashboard-inventory-items-heading"
                  className="text-xs text-semantic-text-tertiary"
                >
                  Inventory items
                </dt>
                <dd className="mt-1 font-heading text-2xl font-bold tabular-nums">
                  {formatDashboardCount(stats?.totalInventoryItems)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card
          role="region"
          aria-labelledby="dashboard-activity-heading"
          className="gap-4 py-4 sm:gap-6 sm:py-6"
        >
          <CardHeader className="px-4 sm:px-6">
            <CardTitle>
              <h2 id="dashboard-activity-heading">Recent activity</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 sm:px-6">
            {recentActivity.length === 0 ? (
              <p className="max-w-prose text-sm text-semantic-text-secondary">
                Activity will appear after scans, imports, or stock edits.
              </p>
            ) : (
              <ul aria-label="Recent dashboard activity">
                {recentActivity.map((activity) => {
                  const activityDate = parseActivityTimestamp(activity.timestamp);

                  return (
                    <li
                      key={`${activity.id}-${activity.timestamp}`}
                      className="mb-2 min-w-0 border-b pb-2 last:border-b-0"
                    >
                      <p className="break-words text-sm">{activity.description}</p>
                      {activityDate ? (
                        <time
                          dateTime={activity.timestamp}
                          className="text-xs text-semantic-text-tertiary"
                        >
                          {formatActivityTimestamp(activityDate)}
                        </time>
                      ) : (
                        <span className="text-xs text-semantic-text-tertiary">
                          Time not available
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
