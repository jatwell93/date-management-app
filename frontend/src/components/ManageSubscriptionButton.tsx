import { useState } from 'react';
import * as Sentry from '@sentry/react';
import { Button } from './ui/button';
import { buildApiUrl } from '../lib/api.service';

interface ManageSubscriptionButtonProps {
  token: string | null;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  className?: string;
}

export function ManageSubscriptionButton({
  token,
  variant = 'outline',
  size = 'default',
  className,
}: ManageSubscriptionButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleManageBilling = async () => {
    if (!token) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(buildApiUrl('/subscription/create-portal-session'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          returnUrl: window.location.href,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create portal session');
      }

      const { url } = await response.json();
      window.location.href = url;
    } catch (error) {
      Sentry.captureException(error, {
        tags: { feature: 'billing-portal' },
      });
      setError('Unable to open billing portal. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={handleManageBilling}
        disabled={loading || !token}
        className={className}
        aria-describedby={error ? 'manage-subscription-error' : undefined}
      >
        {loading ? 'Loading...' : 'Manage Billing'}
      </Button>
      {error && (
        <p id="manage-subscription-error" role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
