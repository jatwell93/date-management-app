import { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { buildApiUrl } from '../lib/api.service';
import type { SubscriptionData, UsageData } from '../types/subscription';

interface SubscriptionDashboardProps {
  token: string | null;
  onUpgrade?: () => void;
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
      <div className="w-full bg-semantic-surface-3 rounded-full h-2.5 dark:bg-semantic-surface-4">
        <div
          className={`h-2.5 rounded-full transition-all ${progressBarColorClass}`}
          style={{ width: `${isUnlimited ? 0 : percentage}%` }}
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={limit || 100}
        />
      </div>
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

export function SubscriptionDashboard({ token, onUpgrade }: SubscriptionDashboardProps) {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const [subscriptionRes, usageRes] = await Promise.all([
          fetch(buildApiUrl('/subscription/current'), {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(buildApiUrl('/organization/usage'), {
            headers: { Authorization: `Bearer ${token}` },
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
  }, [token]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Loading subscription data…</p>
        </CardContent>
      </Card>
    );
  }

  if (error || !subscription || !usage) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-semantic-critical">Unable to load subscription data</p>
          {error && <p className="text-sm text-muted-foreground mt-2">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  const tierColors = {
    starter: 'bg-semantic-surface-2 text-semantic-text-primary border-hairline',
    professional:
      'bg-semantic-secondary-muted text-semantic-secondary-muted-foreground border-semantic-secondary-muted',
    premium:
      'bg-semantic-success-muted text-semantic-success-muted-foreground border-semantic-success-muted',
    concierge:
      'bg-semantic-warning-muted text-semantic-warning-muted-foreground border-semantic-warning-muted',
  };

  const tierDisplayName =
    subscription.tierLevel.charAt(0).toUpperCase() + subscription.tierLevel.slice(1);
  const showUpgrade =
    subscription.tierLevel !== 'premium' && subscription.tierLevel !== 'concierge';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-3">
              <span>Subscription Overview</span>
              <span
                className={`text-sm font-semibold px-3 py-1 rounded-full border ${tierColors[subscription.tierLevel]}`}
              >
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
            <Button onClick={onUpgrade} size="sm">
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
            <Button onClick={onUpgrade} variant="outline" className="w-full">
              Compare Plans
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
