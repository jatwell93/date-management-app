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

  const handleManageBilling = async () => {
    if (!token) return;

    setLoading(true);
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
      alert('Failed to open billing portal. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleManageBilling}
      disabled={loading || !token}
      className={className}
    >
      {loading ? 'Loading...' : 'Manage Billing'}
    </Button>
  );
}
