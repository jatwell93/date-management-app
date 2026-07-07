import { useCallback, useEffect, useState } from 'react';
import * as Sentry from '@sentry/react';
import { SubscriptionDashboard } from '../components/SubscriptionDashboard';
import { UpgradeModal } from '../components/UpgradeModal';
import { ManageSubscriptionButton } from '../components/ManageSubscriptionButton';
import { UsageWarning } from '../components/UsageWarning';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { buildApiUrl } from '../lib/api.service';
import type { TierLevel, SubscriptionData, UsageData } from '../types/subscription';
import { useFreshApiToken } from '../hooks/useFreshApiToken';

interface SubscriptionSettingsPageProps {
  token: string | null;
}

export function SubscriptionSettingsPage({ token }: SubscriptionSettingsPageProps) {
  const getFreshApiToken = useFreshApiToken(token);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [billingLoadError, setBillingLoadError] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const loadSubscriptionData = useCallback(
    async (isMounted: () => boolean = () => true) => {
      if (!token) {
        setSubscription(null);
        setUsage(null);
        setBillingLoadError(null);
        setBillingLoading(false);
        return;
      }

      setBillingLoading(true);
      setBillingLoadError(null);

      try {
        const authToken = await getFreshApiToken('subscription-settings-load');
        const [subscriptionRes, usageRes] = await Promise.all([
          fetch(buildApiUrl('/subscription/current'), {
            headers: { Authorization: `Bearer ${authToken}` },
          }),
          fetch(buildApiUrl('/organization/usage'), {
            headers: { Authorization: `Bearer ${authToken}` },
          }),
        ]);

        if (!subscriptionRes.ok || !usageRes.ok) {
          throw new Error('Failed to fetch subscription settings data');
        }

        const [subscriptionData, usageData] = await Promise.all([
          subscriptionRes.json(),
          usageRes.json(),
        ]);

        if (!isMounted()) {
          return;
        }

        setSubscription(subscriptionData);
        setUsage(usageData);
        setBillingLoadError(null);
      } catch (error) {
        Sentry.captureException(error, {
          tags: { feature: 'subscription-settings' },
        });

        if (!isMounted()) {
          return;
        }

        setSubscription(null);
        setUsage(null);
        setBillingLoadError(
          'Your subscription details could not be loaded. Retry the billing data or contact support if this continues.',
        );
      } finally {
        if (isMounted()) {
          setBillingLoading(false);
        }
      }
    },
    [token, getFreshApiToken],
  );

  useEffect(() => {
    let isMounted = true;

    loadSubscriptionData(() => isMounted);

    return () => {
      isMounted = false;
    };
  }, [loadSubscriptionData]);

  const handleUpgrade = () => {
    setShowUpgradeModal(true);
  };

  // Only paid subscriptions with a reliable Stripe customer can open the billing
  // portal. `active`, `past_due`, and `canceled` all retain one: past_due users
  // need the portal to fix a failed payment, and canceled users can still view
  // past invoices or re-subscribe. Free/trialing users have no Stripe customer
  // yet, so we show a subscribe CTA instead of a button that would 402.
  const canManageBilling =
    !!subscription &&
    subscription.tierLevel !== 'free' &&
    (subscription.status === 'active' ||
      subscription.status === 'past_due' ||
      subscription.status === 'canceled');

  const handleSelectPlan = async (tier: TierLevel, billingCycle: 'monthly' | 'annual') => {
    if (!token) return;

    setCheckoutError(null);

    if (tier === 'free') {
      setShowUpgradeModal(false);
      return;
    }
    if (tier === 'enterprise') {
      setShowUpgradeModal(false);
      setCheckoutError('Enterprise plans are configured by contract. Please contact support.');
      return;
    }

    try {
      const authToken = await getFreshApiToken('subscription-settings-checkout');
      const priceIds = {
        starter: {
          monthly: process.env.REACT_APP_STRIPE_PRICE_STARTER_MONTHLY,
          annual: process.env.REACT_APP_STRIPE_PRICE_STARTER_ANNUAL,
        },
        professional: {
          monthly: process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_MONTHLY,
          annual: process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_ANNUAL,
        },
      };

      const priceId = priceIds[tier as keyof typeof priceIds]?.[billingCycle];
      if (!priceId) {
        setShowUpgradeModal(false);
        setCheckoutError('Price configuration not found. Please contact support.');
        return;
      }

      const response = await fetch(buildApiUrl('/subscription/create-checkout-session'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          priceId,
          successUrl: `${window.location.origin}/settings?upgraded=true`,
          cancelUrl: `${window.location.origin}/settings`,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }

      const { url } = await response.json();
      window.location.href = url;
    } catch (error) {
      Sentry.captureException(error, {
        tags: { feature: 'subscription-upgrade' },
      });
      setShowUpgradeModal(false);
      setCheckoutError('Failed to start upgrade process. Please try again.');
    }
  };

  const handleCancelSubscription = async () => {
    if (!token) return;

    const confirmed = window.confirm(
      'Are you sure you want to cancel your subscription? You will be downgraded to the Starter plan at the end of your billing period.',
    );

    if (!confirmed) return;

    setCheckoutError(null);
    setCancelLoading(true);
    try {
      const authToken = await getFreshApiToken('subscription-settings-cancel');
      const response = await fetch(buildApiUrl('/subscription/cancel'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to cancel subscription');
      }

      window.location.reload();
    } catch (error) {
      Sentry.captureException(error, {
        tags: { feature: 'subscription-cancel' },
      });
      setCheckoutError('Failed to cancel subscription. Please try again or contact support.');
    } finally {
      setCancelLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold font-heading mb-2">Subscription & Billing</h1>
        <p className="text-muted-foreground">
          Manage your subscription, view usage, and update billing information
        </p>
      </div>

      <div className="space-y-6">
        {billingLoadError && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <CardTitle>Unable to load billing settings</CardTitle>
              <CardDescription>{billingLoadError}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => loadSubscriptionData()} disabled={billingLoading}>
                {billingLoading ? 'Retrying...' : 'Retry billing data'}
              </Button>
            </CardContent>
          </Card>
        )}

        {checkoutError && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardHeader>
              <CardTitle>Billing action failed</CardTitle>
              <CardDescription>{checkoutError}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => setCheckoutError(null)}>
                Dismiss
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Main Subscription Dashboard */}
        <SubscriptionDashboard token={token} onUpgrade={handleUpgrade} />

        {/* Usage Warnings */}
        {usage && (
          <div className="space-y-3">
            <UsageWarning
              resourceType="skus"
              current={usage.skus.current}
              limit={usage.skus.limit || Infinity}
              onUpgrade={handleUpgrade}
            />
            <UsageWarning
              resourceType="users"
              current={usage.users.current}
              limit={usage.users.limit}
              onUpgrade={handleUpgrade}
            />
            <UsageWarning
              resourceType="storage"
              current={usage.storage.current}
              limit={usage.storage.limit}
              onUpgrade={handleUpgrade}
              formatValue={(bytes) => {
                const gb = bytes / (1024 * 1024 * 1024);
                return `${gb.toFixed(2)} GB`;
              }}
            />
          </div>
        )}

        {/* Billing Management */}
        <Card>
          <CardHeader>
            <CardTitle>Billing Management</CardTitle>
            <CardDescription>
              {canManageBilling
                ? 'Update payment methods, view invoices, and manage billing details'
                : 'Subscribe to a paid plan to manage payment methods, invoices, and billing details'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              {canManageBilling ? (
                <>
                  <ManageSubscriptionButton token={token} variant="default" />
                  <Button variant="outline" onClick={handleUpgrade}>
                    Change Plan
                  </Button>
                </>
              ) : (
                <Button variant="default" onClick={handleUpgrade}>
                  View plans
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Plan Management */}
        {subscription && subscription.status === 'active' && subscription.tierLevel !== 'free' && (
          <Card>
            <CardHeader>
              <CardTitle>Plan Management</CardTitle>
              <CardDescription>
                Cancel your subscription or make changes to your plan
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 bg-semantic-warning-muted border border-semantic-warning-muted rounded-lg">
                  <p className="text-sm text-semantic-warning-muted-foreground">
                    <strong>Note:</strong> If you cancel, you'll retain access to your current plan
                    until the end of your billing period. After that, you'll be downgraded to the
                    Starter plan.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={handleCancelSubscription}
                  disabled={cancelLoading}
                >
                  {cancelLoading ? 'Canceling...' : 'Cancel Subscription'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Help & Support */}
        <Card>
          <CardHeader>
            <CardTitle>Need Help?</CardTitle>
            <CardDescription>
              Contact our support team for assistance with your subscription
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              If you have questions about billing, plan features, or need assistance, our support
              team is here to help.
            </p>
            <Button variant="outline" onClick={() => window.open('mailto:support@example.com')}>
              Contact Support
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Upgrade Modal */}
      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        onSelectPlan={handleSelectPlan}
        currentTier={subscription?.tierLevel || 'free'}
      />
    </div>
  );
}
