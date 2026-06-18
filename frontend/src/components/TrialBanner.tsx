import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { buildApiUrl } from '../lib/api.service';
import { useFreshApiToken } from '../hooks/useFreshApiToken';

interface SubscriptionTierResponse {
  status: 'ACTIVE' | 'TRIALING' | 'EXPIRED' | 'CANCELED';
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

interface TrialBannerProps {
  token: string | null;
}

export function TrialBanner({ token }: TrialBannerProps) {
  const getFreshApiToken = useFreshApiToken(token);
  const [trialStatus, setTrialStatus] = useState<TrialStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const fetchTrialStatus = async () => {
      try {
        const authToken = await getFreshApiToken('trial-banner-status');
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

  if (dismissed || loading || !token) {
    return null;
  }

  if (error || !trialStatus) {
    return null;
  }

  const { isInTrial, isTrialExpired, subscription, tierLimits } = trialStatus;
  const tierLevel = subscription?.tierLevel?.toLowerCase() || 'free';
  const isPaidTier = tierLevel !== 'free' && !isInTrial;

  const daysRemaining = subscription?.daysRemaining ?? 0;
  if (isInTrial && daysRemaining > 0) {
    const isUrgent = daysRemaining <= 5;

    return (
      <div className="w-full mb-4">
        <Card
          className={
            isUrgent
              ? 'bg-semantic-warning-muted border-semantic-warning-muted py-0 rounded-md'
              : 'bg-semantic-secondary-muted border-semantic-secondary-muted py-0 rounded-md'
          }
        >
          <CardContent className="py-2 px-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`size-2 rounded-full ${
                    isUrgent ? 'bg-semantic-warning' : 'bg-semantic-secondary'
                  }`}
                />
                <div>
                  <p
                    className={`text-sm font-medium ${
                      isUrgent
                        ? 'text-semantic-warning-muted-foreground'
                        : 'text-semantic-secondary-muted-foreground'
                    }`}
                  >
                    {isUrgent
                      ? `Only ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left in your trial!`
                      : `You have ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left in your Professional trial`}
                  </p>
                  <p
                    className={`text-xs ${
                      isUrgent ? 'text-semantic-warning' : 'text-semantic-secondary'
                    }`}
                  >
                    Upgrade now to keep all {tierLimits.maxProducts} products and{' '}
                    {tierLimits.maxUsers} users
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => navigate('/upgrade')}
                className={
                  isUrgent
                    ? 'bg-semantic-warning-hover hover:bg-semantic-warning-active text-semantic-warning-foreground'
                    : 'bg-semantic-primary hover:bg-semantic-primary-hover text-semantic-primary-foreground'
                }
              >
                Upgrade Now
              </Button>
              <button
                type="button"
                aria-label="Dismiss trial message"
                onClick={() => setDismissed(true)}
                className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-md outline-none transition-colors focus-visible:border-semantic-primary focus-visible:ring-[3px] focus-visible:ring-semantic-primary/50 ${
                  isUrgent
                    ? 'text-semantic-warning-muted-foreground hover:bg-semantic-warning/10'
                    : 'text-semantic-secondary-muted-foreground hover:bg-semantic-secondary/10'
                }`}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isTrialExpired) {
    return (
      <div className="w-full mb-4">
        <Card className="bg-semantic-surface-2 border-semantic-surface-4">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="size-2 rounded-full bg-semantic-text-tertiary" />
                <div>
                  <p className="text-sm font-medium text-semantic-text-primary">
                    You're on the Starter plan (trial expired)
                  </p>
                  <p className="text-xs text-semantic-text-secondary">
                    Limited to {tierLimits.maxProducts} products and {tierLimits.maxUsers} user
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate('/upgrade')}>
                View Plans
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isPaidTier && subscription) {
    const billingCycle = subscription.billingCycle || 'monthly';
    const price = billingCycle === 'annual' ? '$19/month' : '$29/month';

    return (
      <div className="w-full mb-4">
        <Card className="bg-semantic-success-muted border-semantic-success-muted">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="size-2 rounded-full bg-semantic-success animate-pulse" />
                <div>
                  <p className="text-sm font-medium text-semantic-success-muted-foreground">
                    Active subscription: {tierLevel.charAt(0).toUpperCase() + tierLevel.slice(1)} (
                    {price})
                  </p>
                  <p className="text-xs text-semantic-success">
                    {tierLimits.maxProducts} products,{' '}
                    {tierLimits.maxUsers === -1 ? 'unlimited' : tierLimits.maxUsers} users
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate('/settings')}>
                Billing Settings
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
