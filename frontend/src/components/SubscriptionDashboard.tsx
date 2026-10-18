import { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { buildApiUrl } from '../lib/api.service';
import type { SubscriptionData, UsageData } from '../types/subscription';
import { useFreshApiToken } from '../hooks/useFreshApiToken';

/**
 * Data already loaded by the parent. When supplied, the dashboard does not
 * fetch on its own, so a parent retry or post-cancel reload refreshes it too.
 */
export interface SubscriptionDashboardData {
  subscription: SubscriptionData | null;
  usage: UsageData | null;
  loading: boolean;
  /** Set when the parent's load failed; the parent renders the error and retry. */
  error: string | null;
}

interface SubscriptionDashboardProps {
  token: string | null;
  onUpgrade?: () => void;
  data?: SubscriptionDashboardData;
}

interface ProgressBarProps {
  label: string;
  current: number;
  limit: number | null;
  formatValue?: (value: number) => string;
}

function ProgressBar({ label, current, limit, formatValue }: ProgressBarProps) {
  const percentage = limit === null ? 0 : Math.min((current / limit) * 100, 100);
  const isUnlimited = limit === null;
  const isWarning = percentage >= 80 && percentage < 95;
  const isDanger = percentage >= 95;
  const progressBarColorClass = isDanger
    ? 'bg-semantic-critical'
    : isWarning
      ? 'bg-semantic-warning'
      : 'bg-semantic-secondary';

  const displayCurrent = formatValue ? formatValue(current) : current.toLocaleString();
  const displayLimit = isUnlimited
    ? 'Unlimited'
    : formatValue
      ? formatValue(limit)
      : limit.toLocaleString();

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {displayCurrent} / {displayLimit}
        </span>
      </div>
      {/* Unlimited resources have no meaningful maximum, so no progressbar is
          exposed; the "x / Unlimited" text above carries the value. */}
      {!isUnlimited && (
        <div className="w-full bg-semantic-surface-3 rounded-full h-2.5 dark:bg-semantic-surface-4">
          <div
            className={`h-2.5 rounded-full motion-safe:transition-[width] ${progressBarColorClass}`}
            style={{ width: `${percentage}%` }}
            role="progressbar"
            aria-label={`${label} usage`}
            aria-valuenow={Math.min(current, limit)}
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuetext={`${displayCurrent} of ${displayLimit} used`}
          />
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function SubscriptionDashboard({ token, onUpgrade, data }: SubscriptionDashboardProps) {
  const getFreshApiToken = useFreshApiToken(token);
  const [fetchedSubscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [fetchedUsage, setUsage] = useState<UsageData | null>(null);
  const [fetchLoading, setLoading] = useState(true);
  const [fetchError, setError] = useState<string | null>(null);
  const isControlled = data !== undefined;

  useEffect(() => {
    if (isControlled) {
      return;
    }

    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: guard state when the auth prerequisite is absent
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const authToken = await getFreshApiToken('subscription-dashboard');
        const [subscriptionRes, usageRes] = await Promise.all([
          fetch(buildApiUrl('/subscription/current'), {
            headers: { Authorization: `Bearer ${authToken}` },
          }),
          fetch(buildApiUrl('/organization/usage'), {
            headers: { Authorization: `Bearer ${authToken}` },
          }),
        ]);

        if (!subscriptionRes.ok || !usageRes.ok) {
          throw new Error('Failed to fetch subscription data');
        }

        const subscriptionData = await subscriptionRes.json();
        const usageData = await usageRes.json();

        setSubscription(subscriptionData);
        setUsage(usageData);
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: 'subscription-dashboard' },
        });
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token, getFreshApiToken, isControlled]);

  const subscription = isControlled ? data.subscription : fetchedSubscription;
  const usage = isControlled ? data.usage : fetchedUsage;
  const loading = isControlled ? data.loading : fetchLoading;
  const error = isControlled ? data.error : fetchError;

  // The parent already shows its own error card with a retry action.
  if (isControlled && error && !loading) {
    return null;
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p role="status" className="text-muted-foreground">
            Loading subscription data…
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error || !subscription || !usage) {
    return (
      <Card>
        <CardContent role="alert" className="py-8 text-center">
          <p className="text-semantic-critical">Unable to load subscription data</p>
          {error && <p className="text-sm text-muted-foreground mt-2">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  const tierColors = {
    free: 'bg-semantic-surface-2 text-semantic-text-primary border-hairline',
    starter: 'bg-semantic-surface-2 text-semantic-text-primary border-hairline',
    professional:
      'bg-semantic-secondary-muted text-semantic-secondary-muted-foreground border-semantic-secondary-muted',
    premium:
      'bg-semantic-success-muted text-semantic-success-muted-foreground border-semantic-success-muted',
    concierge:
      'bg-semantic-warning-muted text-semantic-warning-muted-foreground border-semantic-warning-muted',
    enterprise:
      'bg-semantic-warning-muted text-semantic-warning-muted-foreground border-semantic-warning-muted',
  };

  const tierDisplayName =
    subscription.tierLevel.charAt(0).toUpperCase() + subscription.tierLevel.slice(1);
  const showUpgrade =
    subscription.tierLevel !== 'enterprise' &&
    subscription.tierLevel !== 'premium' &&
    subscription.tierLevel !== 'concierge';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle role="heading" aria-level={2} className="flex items-center gap-3">
              <span>Subscription Overview</span>
              <span
                className={`text-sm font-semibold px-3 py-1 rounded-full border ${tierColors[subscription.tierLevel]}`}
              >
                <span className="sr-only">Current plan: </span>
                {tierDisplayName}
              </span>
            </CardTitle>
            <CardDescription>
              {subscription.status === 'active' && subscription.billingCycle && (
                <span>
                  Billed {subscription.billingCycle}
                  {subscription.currentPeriodEnd && (
                    <> • Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</>
                  )}
                </span>
              )}
              {subscription.status === 'trialing' && <span>Trial period active</span>}
              {subscription.status === 'past_due' && (
                <span className="text-semantic-critical">Payment past due</span>
              )}
              {subscription.status === 'canceled' && (
                <span className="text-muted-foreground">Subscription canceled</span>
              )}
            </CardDescription>
          </div>
          {showUpgrade && onUpgrade && (
            <Button onClick={onUpgrade} className="min-h-11">
              Upgrade Plan
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Resource Usage
          </h3>

          <ProgressBar
            label="SKUs (Products)"
            current={usage.skus.current}
            limit={usage.skus.limit}
          />

          <ProgressBar label="Users" current={usage.users.current} limit={usage.users.limit} />

          <ProgressBar
            label="Storage"
            current={usage.storage.current}
            limit={usage.storage.limit}
            formatValue={formatBytes}
          />

          <ProgressBar
            label="Inventory Items"
            current={usage.inventoryItems.current}
            limit={usage.inventoryItems.limit}
          />
        </div>

        {showUpgrade && onUpgrade && (
          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground mb-3">
              Need more resources? Upgrade to unlock higher limits and premium features.
            </p>
            <Button onClick={onUpgrade} variant="outline" className="w-full min-h-11">
              Compare Plans
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
