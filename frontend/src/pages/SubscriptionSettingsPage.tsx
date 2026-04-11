import { useEffect, useState } from 'react';
import * as Sentry from '@sentry/react';
import { SubscriptionDashboard } from '../components/SubscriptionDashboard';
import { UpgradeModal } from '../components/UpgradeModal';
import { ManageSubscriptionButton } from '../components/ManageSubscriptionButton';
import { UsageWarning } from '../components/UsageWarning';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { buildApiUrl } from '../lib/api.service';
import type { TierLevel, SubscriptionData, UsageData } from '../types/subscription';

interface SubscriptionSettingsPageProps {
  token: string | null;
}

export function SubscriptionSettingsPage({ token }: SubscriptionSettingsPageProps) {
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setSubscription(null);
      setUsage(null);
      return;
    }

    let isMounted = true;

    const loadSubscriptionData = async () => {
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
          throw new Error('Failed to fetch subscription settings data');
        }

        const [subscriptionData, usageData] = await Promise.all([
          subscriptionRes.json(),
          usageRes.json(),
        ]);

        if (!isMounted) {
          return;
        }

        setSubscription(subscriptionData);
        setUsage(usageData);
      } catch (error) {
        Sentry.captureException(error, {
          tags: { feature: 'subscription-settings' },
        });

        if (!isMounted) {
          return;
        }

        setSubscription(null);
        setUsage(null);
      }
    };

    loadSubscriptionData();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const handleUpgrade = () => {
    setShowUpgradeModal(true);
  };

  const handleSelectPlan = async (tier: TierLevel, billingCycle: 'monthly' | 'annual') => {
    if (!token) return;

    try {
      // Map tier to Stripe price ID (these would come from environment or config)
      const priceIds = {
        starter: {
          monthly: process.env.REACT_APP_STRIPE_PRICE_STARTER_MONTHLY,
          annual: process.env.REACT_APP_STRIPE_PRICE_STARTER_ANNUAL,
        },
        professional: {
          monthly: process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_MONTHLY,
          annual: process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_ANNUAL,
        },
        premium: {
          monthly: process.env.REACT_APP_STRIPE_PRICE_PREMIUM_MONTHLY,
          annual: process.env.REACT_APP_STRIPE_PRICE_PREMIUM_ANNUAL,
        },
        concierge: {
          monthly: process.env.REACT_APP_STRIPE_PRICE_CONCIERGE_MONTHLY,
          annual: process.env.REACT_APP_STRIPE_PRICE_CONCIERGE_MONTHLY,
        },
      };

      const priceId = priceIds[tier]?.[billingCycle];
      if (!priceId) {
        alert('Price configuration not found. Please contact support.');
        return;
      }

      const response = await fetch(buildApiUrl('/subscription/create-checkout-session'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
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
      alert('Failed to start upgrade process. Please try again.');
    }
  };

  const handleCancelSubscription = async () => {
    if (!token) return;

    const confirmed = window.confirm(
      'Are you sure you want to cancel your subscription? You will be downgraded to the Starter plan at the end of your billing period.',
    );

    if (!confirmed) return;

    setCancelLoading(true);
    try {
      const response = await fetch(buildApiUrl('/subscription/cancel'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to cancel subscription');
      }

      alert(
        'Your subscription has been scheduled for cancellation at the end of the billing period.',
      );
      window.location.reload();
    } catch (error) {
      Sentry.captureException(error, {
        tags: { feature: 'subscription-cancel' },
      });
      alert('Failed to cancel subscription. Please try again or contact support.');
    } finally {
      setCancelLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Subscription & Billing</h1>
        <p className="text-muted-foreground">
          Manage your subscription, view usage, and update billing information
        </p>
      </div>

      <div className="space-y-6">
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
              Update payment methods, view invoices, and manage billing details
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <ManageSubscriptionButton token={token} variant="default" />
              <Button variant="outline" onClick={handleUpgrade}>
                Change Plan
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Plan Management */}
        {subscription &&
          subscription.status === 'active' &&
          subscription.tierLevel !== 'starter' && (
            <Card>
              <CardHeader>
                <CardTitle>Plan Management</CardTitle>
                <CardDescription>
                  Cancel your subscription or make changes to your plan
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg dark:bg-amber-950/30 dark:border-amber-800">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      <strong>Note:</strong> If you cancel, you'll retain access to your current
                      plan until the end of your billing period. After that, you'll be downgraded to
                      the Starter plan.
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
        currentTier={subscription?.tierLevel || 'starter'}
      />
    </div>
  );
}
