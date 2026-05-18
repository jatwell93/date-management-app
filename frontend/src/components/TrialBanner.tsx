import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { buildApiUrl } from '../lib/api.service';

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
  const [trialStatus, setTrialStatus] = useState<TrialStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

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

  if (loading || !token) {
    return null;
  }

  if (error || !trialStatus) {
    return null;
  }

  const { isInTrial, isTrialExpired, subscription, tierLimits } = trialStatus;
  const tierLevel = subscription?.tierLevel?.toLowerCase() || 'starter';
  const isPaidTier = tierLevel !== 'starter' && !isInTrial;

  const daysRemaining = subscription?.daysRemaining ?? 0;
  if (isInTrial && daysRemaining > 0) {
    const isUrgent = daysRemaining <= 5;

    return (
      <div className="w-full mb-4">
        <Card
          className={
            isUrgent
              ? 'bg-semantic-warning-muted border-semantic-warning-muted'
              : 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800'
          }
        >
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isUrgent ? 'bg-semantic-warning' : 'bg-blue-500'
                  }`}
                />
                <div>
                  <p
                    className={`text-sm font-medium ${
                      isUrgent
                        ? 'text-semantic-warning-muted-foreground'
                        : 'text-blue-800 dark:text-blue-200'
                    }`}
                  >
                    {isUrgent
                      ? `Only ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left in your trial!`
                      : `You have ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left in your Professional trial`}
                  </p>
                  <p
                    className={`text-xs ${
                      isUrgent ? 'text-semantic-warning' : 'text-blue-600 dark:text-blue-300'
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
                    ? 'bg-semantic-warning hover:bg-semantic-warning-hover text-semantic-warning-foreground'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }
              >
                Upgrade Now
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isTrialExpired) {
    return (
      <div className="w-full mb-4">
        <Card className="bg-gray-50 border-gray-200 dark:bg-gray-950/30 dark:border-gray-800">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-gray-500" />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    You're on the Starter plan (trial expired)
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
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
        <Card className="bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    Active subscription: {tierLevel.charAt(0).toUpperCase() + tierLevel.slice(1)} (
                    {price})
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-300">
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
