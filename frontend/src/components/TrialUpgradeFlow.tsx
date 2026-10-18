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

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function ActivePlanCard({ tierLevel, billingCycle }: ActivePlanCardProps) {
  const planName = capitalize(tierLevel);

  return (
    <Card
      role="region"
      aria-labelledby="upgrade-active-plan-heading"
      className="mx-auto w-full max-w-md"
    >
      <CardHeader>
        <CardTitle id="upgrade-active-plan-heading" role="heading" aria-level={1}>
          {planName} plan active
        </CardTitle>
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
  tierLevel: string;
}

function UpgradeHeader({
  isInTrial,
  isTrialExpired,
  status,
  daysRemaining,
  tierLimits,
  tierLevel,
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
      <h1
        id="upgrade-heading"
        className="text-3xl font-semibold font-heading mb-2 flex items-center gap-2"
      >
        {isInTrial && (
          <span
            aria-hidden="true"
            className="size-3 rounded-full bg-semantic-secondary motion-safe:animate-pulse"
          />
        )}
        {isInTrial ? 'Professional Trial' : `${capitalize(tierLevel)} plan`}
      </h1>
      <p className="text-muted-foreground">{getDescription()}</p>

      {/* The trial-status payload carries limits only, not live usage, so this
          card states the limits rather than showing placeholder usage counts. */}
      <Card className="mt-6 max-w-md">
        <CardHeader>
          <CardTitle role="heading" aria-level={2} className="text-base">
            Your plan limits
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2">
            {[
              { label: 'Products', value: tierLimits.maxProducts },
              { label: 'Users', value: tierLimits.maxUsers },
              { label: 'Store Areas', value: tierLimits.maxStoreAreas },
            ].map((row) => (
              <div key={row.label} className="flex justify-between text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="tabular-nums">up to {row.value.toLocaleString('en-AU')}</dd>
              </div>
            ))}
          </dl>
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: guard state when the auth prerequisite is absent
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
      setError('Enterprise plans are configured by contract. Please contact support.');
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
        // A non-JSON error body (e.g. a gateway page) must not replace the message.
        const data = await response.json().catch(() => ({}));
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

  if (!token) {
    return null;
  }

  if (loading) {
    return (
      <p role="status" className="py-8 text-center text-muted-foreground">
        Loading plan details…
      </p>
    );
  }

  if (!trialStatus) {
    return (
      <Card className="mx-auto w-full max-w-md">
        <CardContent role="alert" className="py-8 text-center text-muted-foreground">
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
    <section aria-labelledby="upgrade-heading" className="mx-auto w-full max-w-6xl">
      <UpgradeHeader
        isInTrial={isInTrial}
        isTrialExpired={isTrialExpired}
        status={status}
        daysRemaining={daysRemaining}
        tierLimits={tierLimits}
        tierLevel={tierLevel}
      />

      {error && (
        <div
          role="alert"
          className="mb-6 max-w-md p-3 bg-semantic-critical-muted border border-semantic-critical-muted rounded-md"
        >
          <p className="text-sm text-semantic-critical-muted-foreground">{error}</p>
        </div>
      )}

      {/* Users without a paid plan can upgrade to any tier — pass 'free' so every
          paid tier renders as an upgrade rather than a disabled current plan. */}
      <PlanComparison
        currentTier="free"
        onSelectPlan={handleUpgrade}
        busyTier={converting ? selectedTier : null}
      />
    </section>
  );
}
