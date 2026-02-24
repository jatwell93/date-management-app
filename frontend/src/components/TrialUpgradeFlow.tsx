import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

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

interface TrialUpgradeFlowProps {
  token: string | null;
}

export function TrialUpgradeFlow({ token }: TrialUpgradeFlowProps) {
  const [trialStatus, setTrialStatus] = useState<TrialStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    const fetchTrialStatus = async () => {
      try {
        const response = await fetch('/api/subscription/trial-status', {
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
        console.error('Error fetching trial status:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchTrialStatus();
  }, [token]);

  const handleUpgrade = async (billingCycle: 'monthly' | 'annual') => {
    if (!token || !trialStatus?.isInTrial) return;

    setConverting(true);
    setError(null);

    try {
      const response = await fetch('/api/subscription/convert-trial', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          paymentMethodId: 'pm_mock_for_testing',
          billingCycle,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to convert trial');
      }

      const data = await response.json();

      if (data.success) {
        navigate('/settings?upgraded=true');
      }
    } catch (err) {
      console.error('Error converting trial:', err);
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

  const { isInTrial, subscription, tierLimits } = trialStatus;
  const daysRemaining = subscription?.daysRemaining ?? 0;

  if (!isInTrial) {
    return null;
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
          Professional Trial
        </CardTitle>
        <CardDescription>
          {daysRemaining > 0
            ? `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`
            : 'Trial expired'}
        </CardDescription>
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
          <h4 className="text-sm font-medium">Upgrade to Professional</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 border rounded-lg space-y-1">
              <p className="font-semibold">Monthly</p>
              <p className="text-2xl font-bold">
                $29<span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-xs text-muted-foreground">Billed monthly</p>
            </div>
            <div className="p-3 border rounded-lg space-y-1 relative">
              <div className="absolute -top-2 -right-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">
                Save 30%
              </div>
              <p className="font-semibold">Annual</p>
              <p className="text-2xl font-bold">
                $19<span className="text-sm font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="text-xs text-muted-foreground">Billed $228 yearly</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="flex gap-3">
          <Button className="flex-1" onClick={() => handleUpgrade('monthly')} disabled={converting}>
            {converting ? 'Processing...' : 'Upgrade Monthly'}
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            onClick={() => handleUpgrade('annual')}
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
