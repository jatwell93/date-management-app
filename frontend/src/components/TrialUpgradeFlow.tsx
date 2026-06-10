import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { buildApiUrl } from '../lib/api.service';

interface SubscriptionTierResponse {
  status: 'active' | 'trialing' | 'expired' | 'canceled';
  tierLevel: string;
  trialEndDate: string | null;
  trialStartedAt: string | null;
  trialConvertedAt: string | null;
  daysRemaining: number | null;
  billingCycle: string | null;
}

interface TrialStatusResponse {
  isInTrial: boolean;
  isTrialExpired: boolean;
  subscription: SubscriptionTierResponse | null;
  tierLimits: {
    maxUsers: number;
    maxProducts: number;
    maxStoreAreas: number;
    features: string[];
  };
}

interface TrialUpgradeFlowProps {
  token: string | null;
}

interface ActivePlanCardProps {
  tierLevel: string;
  billingCycle: string | null;
}

function ActivePlanCard({ tierLevel, billingCycle }: ActivePlanCardProps) {
  const planName = `${tierLevel.charAt(0).toUpperCase()}${tierLevel.slice(1)}`;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{planName} plan active</CardTitle>
        <CardDescription>
          Your current paid plan is active
          {billingCycle ? ` and billed ${billingCycle}` : ''}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Manage payment methods, invoices, and plan changes from Billing under Account.
        </p>
      </CardContent>
    </Card>
  );
}

interface UpgradeCardProps {
  isInTrial: boolean;
  isTrialExpired: boolean;
  status: SubscriptionTierResponse['status'] | undefined;
  daysRemaining: number;
  tierLimits: TrialStatusResponse['tierLimits'];
  error: string | null;
  converting: boolean;
  onUpgrade: (billingCycle: 'monthly' | 'annual') => void;
}

function UpgradeCard({
  isInTrial,
  isTrialExpired,
  status,
  daysRemaining,
  tierLimits,
  error,
  converting,
  onUpgrade,
}: UpgradeCardProps) {
  function getDescription(): string {
    if (isInTrial && daysRemaining > 0) {
      return `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`;
    }
    if (isTrialExpired || status === 'expired') {
      return 'Trial expired. Upgrade to restore full access.';
    }
    return 'Upgrade to Professional when you need more capacity.';
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isInTrial && (
            <span className="size-3 rounded-full bg-semantic-secondary animate-pulse" />
          )}
          {isInTrial ? 'Professional Trial' : 'Starter plan'}
        </CardTitle>
        <CardDescription>{getDescription()}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Your Current Usage</h4>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Products</span>
              <span>0 / {tierLimits.maxProducts}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Users</span>
              <span>1 / {tierLimits.maxUsers}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Store Areas</span>
              <span>0 / {tierLimits.maxStoreAreas}</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-medium font-heading">Upgrade to Professional</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 border rounded-lg space-y-1">
              <p className="font-semibold">Monthly</p>
              <p className="text-2xl font-bold font-heading">
                $29<span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-xs text-muted-foreground">Billed monthly</p>
            </div>
            <div className="p-3 border rounded-lg space-y-1 relative">
              <div className="absolute -top-2 -right-2 bg-semantic-success text-semantic-success-foreground text-xs px-2 py-0.5 rounded-full">
                Save 30%
              </div>
              <p className="font-semibold">Annual</p>
              <p className="text-2xl font-bold font-heading">
                $19<span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-xs text-muted-foreground">Billed $228 yearly</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-semantic-critical-muted border border-semantic-critical-muted rounded-md">
            <p className="text-sm text-semantic-critical">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <Button className="flex-1" onClick={() => onUpgrade('monthly')} disabled={converting}>
            {converting ? 'Processing...' : 'Upgrade Monthly'}
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            onClick={() => onUpgrade('annual')}
            disabled={converting}
          >
            {converting ? 'Processing...' : 'Upgrade Annual'}
          </Button>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          Upgrade now to keep your data and continue using all features
        </p>
      </CardContent>
    </Card>
  );
}

export function TrialUpgradeFlow({ token }: TrialUpgradeFlowProps) {
  const [trialStatus, setTrialStatus] = useState<TrialStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const fetchTrialStatus = async () => {
      try {
        const response = await fetch(buildApiUrl('/subscription/trial-status'), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch trial status');
        }

        const data = await response.json();
        setTrialStatus(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchTrialStatus();
  }, [token]);

  const handleUpgrade = async (billingCycle: 'monthly' | 'annual') => {
    if (!token || !trialStatus) return;

    setConverting(true);
    setError(null);

    try {
      const priceIds = {
        monthly: process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_MONTHLY,
        annual: process.env.REACT_APP_STRIPE_PRICE_PROFESSIONAL_ANNUAL,
      };
      const priceId = priceIds[billingCycle];

      if (!priceId) {
        throw new Error('Price configuration not found. Please contact support.');
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
          cancelUrl: `${window.location.origin}/upgrade`,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to convert trial');
      }

      const data = await response.json();

      if (typeof data.url === 'string') {
        window.open(data.url, '_self', 'noopener');
      } else {
        throw new Error('Unable to start checkout. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upgrade');
    } finally {
      setConverting(false);
    }
  };

  if (loading || !token) {
    return null;
  }

  if (!trialStatus) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="py-8 text-center text-muted-foreground">
          Unable to load trial status
        </CardContent>
      </Card>
    );
  }

  const { isInTrial, isTrialExpired, subscription, tierLimits } = trialStatus;
  const daysRemaining = subscription?.daysRemaining ?? 0;
  const tierLevel = subscription?.tierLevel?.toLowerCase() || 'free';
  const status = subscription?.status;
  const isActivePaidPlan = status === 'active' && tierLevel !== 'free';

  if (isActivePaidPlan) {
    return (
      <ActivePlanCard tierLevel={tierLevel} billingCycle={subscription?.billingCycle ?? null} />
    );
  }

  return (
    <UpgradeCard
      isInTrial={isInTrial}
      isTrialExpired={isTrialExpired}
      status={status}
      daysRemaining={daysRemaining}
      tierLimits={tierLimits}
      error={error}
      converting={converting}
      onUpgrade={handleUpgrade}
    />
  );
}
