import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { buttonVariants } from '../components/ui/button';
import { apiService } from '../lib/api.service';
import { useFreshApiToken } from '../hooks/useFreshApiToken';

interface DashboardPageProps {
  token: string | null;
}

interface DashboardStats {
  totalProducts: number;
  totalInventoryItems: number;
  expiringItems: number;
  expiredActionItems: number;
}

interface LastCatalogueUpload {
  fileName: string;
  uploadedAt: string;
}

interface DashboardActivity {
  lastCatalogueUpload: LastCatalogueUpload | null;
  expiredItemsEnteredToday: number;
  stockLossLast30Days: number;
}

// The Workers API (GET /api/dashboard) returns `{ stats, activity }`.
// `stats` drives the "Needs attention" tiles (near-expiry stock and expired
// items awaiting a sold-through/expired decision). `activity` surfaces catalogue
// freshness and stock-loss signals in place of the old (never-populated) event
// feed, which used to call `.map` on an undefined `recentActivity` and threw.
interface DashboardResponse {
  stats: DashboardStats;
  activity?: DashboardActivity;
}

const dashboardCountFormatter = new Intl.NumberFormat('en-AU');
const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});
const activityTimestampFormatter = new Intl.DateTimeFormat('en-AU', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDashboardCount(value: number | undefined): string {
  return dashboardCountFormatter.format(value ?? 0);
}

function formatCurrency(value: number | undefined): string {
  return currencyFormatter.format(value ?? 0);
}

function formatUploadTimestamp(timestamp: string): string | null {
  const uploadDate = new Date(timestamp);

  if (Number.isNaN(uploadDate.getTime())) {
    return null;
  }

  return activityTimestampFormatter.format(uploadDate);
}

export function DashboardPage({ token }: DashboardPageProps) {
  const getFreshApiToken = useFreshApiToken(token);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<DashboardActivity | null>(null);
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
        const authToken = await getFreshApiToken('dashboard-fetch');
        const data = await apiService.get<DashboardResponse>('/dashboard', authToken);
        setStats(data?.stats ?? null);
        setActivity(data?.activity ?? null);
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
  }, [token, getFreshApiToken]);

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
  const expiredActionItems = stats?.expiredActionItems ?? 0;
  const attentionItems = expiringItems + expiredActionItems;
  const lastCatalogueUpload = activity?.lastCatalogueUpload ?? null;
  const lastCatalogueUploadTimestamp = lastCatalogueUpload
    ? formatUploadTimestamp(lastCatalogueUpload.uploadedAt)
    : null;

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
          Review expiring stock and expired items awaiting a decision.
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
                  Within 30 days of expiry — plan markdowns.
                </p>
              </div>

              <div className="rounded-md border border-semantic-critical/20 bg-semantic-critical-muted p-3 sm:p-4">
                <h3 id="dashboard-expired-action-heading" className="text-sm font-semibold">
                  Expired — needs action
                </h3>
                <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-semantic-critical sm:mt-2 sm:text-3xl">
                  {formatDashboardCount(expiredActionItems)}
                </p>
                <p className="mt-1 text-xs text-semantic-critical-muted-foreground">
                  Mark these as sold-through or expired.
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
            <dl className="space-y-4" aria-label="Recent dashboard activity">
              <div className="min-w-0 border-b pb-3">
                <dt className="text-xs text-semantic-text-tertiary">Catalogue last updated</dt>
                {lastCatalogueUpload ? (
                  <dd className="mt-1 min-w-0">
                    <p className="break-words text-sm font-medium">
                      {lastCatalogueUpload.fileName}
                    </p>
                    {lastCatalogueUploadTimestamp ? (
                      <time
                        dateTime={lastCatalogueUpload.uploadedAt}
                        className="text-xs text-semantic-text-tertiary"
                      >
                        {lastCatalogueUploadTimestamp}
                      </time>
                    ) : (
                      <span className="text-xs text-semantic-text-tertiary">
                        Time not available
                      </span>
                    )}
                  </dd>
                ) : (
                  <dd className="mt-1 text-sm text-semantic-text-secondary">
                    No catalogue uploaded yet.
                  </dd>
                )}
              </div>

              <div className="min-w-0 border-b pb-3">
                <dt className="text-xs text-semantic-text-tertiary">Expired items added today</dt>
                <dd className="mt-1 font-heading text-2xl font-bold tabular-nums">
                  {formatDashboardCount(activity?.expiredItemsEnteredToday)}
                </dd>
              </div>

              <div className="min-w-0">
                <dt className="text-xs text-semantic-text-tertiary">Stock loss (last 30 days)</dt>
                <dd className="mt-1 font-heading text-2xl font-bold tabular-nums text-semantic-critical">
                  {formatCurrency(activity?.stockLossLast30Days)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
