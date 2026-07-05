import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { PlanComparison } from './PlanComparison';
import { buildApiUrl } from '../lib/api.service';
import { useFreshApiToken } from '../hooks/useFreshApiToken';
import type { BillingCycle, LaunchTier } from '../lib/planCatalog';

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

interface UpgradeHeaderProps {
  isInTrial: boolean;
  isTrialExpired: boolean;
  status: SubscriptionTierResponse['status'] | undefined;
  daysRemaining: number;
  tierLimits: TrialStatusResponse['tierLimits'];
}

function UpgradeHeader({
  isInTrial,
  isTrialExpired,
  status,
  daysRemaining,
  tierLimits,
}: UpgradeHeaderProps) {
  function getDescription(): string {
    if (isInTrial && daysRemaining > 0) {
      return `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining on your Professional trial`;
    }
    if (isTrialExpired || status === 'expired') {
      return 'Trial expired. Upgrade to restore full access.';
    }
    return 'Upgrade to Professional when you need more capacity.';
  }

  return (
    <div className="mb-8">
      <h1 className="text-3xl font-semibold font-heading mb-2 flex items-center gap-2">
        {isInTrial && <span className="size-3 rounded-full bg-semantic-secondary animate-pulse" />}
        {isInTrial ? 'Professional Trial' : 'Starter plan'}
      </h1>
      <p className="text-muted-foreground">{getDescription()}</p>

      <Card className="mt-6 max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Your current usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Products</span>
            <span className="tabular-nums">0 / {tierLimits.maxProducts}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Users</span>
            <span className="tabular-nums">1 / {tierLimits.maxUsers}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Store Areas</span>
            <span className="tabular-nums">0 / {tierLimits.maxStoreAreas}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function TrialUpgradeFlow({ token }: TrialUpgradeFlowProps) {
  const getFreshApiToken = useFreshApiToken(token);
  const [trialStatus, setTrialStatus] = useState<TrialStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [selectedTier, setSelectedTier] = useState<LaunchTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const fetchTrialStatus = async () => {
      try {
        const authToken = await getFreshApiToken('trial-upgrade-status');
        const response = await fetch(buildApiUrl('/subscription/trial-status'), {
          headers: {
            Authorization: `Bearer ${authToken}`,
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
  }, [token, getFreshApiToken]);

  const handleUpgrade = async (tier: LaunchTier, billingCycle: BillingCycle) => {
    if (!token || !trialStatus) return;

    // Free is a no-op (nothing to buy); Enterprise is contract-based.
    if (tier === 'free') return;
    if (tier === 'enterprise') {
      alert('Enterprise plans are configured by contract. Please contact support.');
      return;
    }

    setSelectedTier(tier);
    setConverting(true);
    setError(null);

    try {
      const authToken = await getFreshApiToken('trial-upgrade-checkout');
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
      const priceId = priceIds[tier as 'starter' | 'professional']?.[billingCycle];

      if (!priceId) {
        throw new Error('Price configuration not found. Please contact support.');
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
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <UpgradeHeader
        isInTrial={isInTrial}
        isTrialExpired={isTrialExpired}
        status={status}
        daysRemaining={daysRemaining}
        tierLimits={tierLimits}
      />

      {error && (
        <div className="mb-6 max-w-md p-3 bg-semantic-critical-muted border border-semantic-critical-muted rounded-md">
          <p className="text-sm text-semantic-critical">{error}</p>
        </div>
      )}

      {/* Users without a paid plan can upgrade to any tier — pass 'free' so every
          paid tier renders as an upgrade rather than a disabled current plan. */}
      <PlanComparison
        currentTier="free"
        onSelectPlan={handleUpgrade}
        busyTier={converting ? selectedTier : null}
      />
    </div>
  );
}
