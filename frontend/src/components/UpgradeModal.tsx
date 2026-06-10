import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import type { TierLevel } from '../types/subscription';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPlan: (tier: TierLevel, billingCycle: 'monthly' | 'annual') => void;
  currentTier: TierLevel;
}

interface TierPricing {
  monthly: number;
  annual: number;
}

type LaunchTier = 'free' | 'starter' | 'professional' | 'enterprise';

const TIER_PRICING: Record<'free' | 'starter' | 'professional', TierPricing> = {
  free: { monthly: 0, annual: 0 },
  starter: { monthly: 39, annual: 390 },
  professional: { monthly: 99, annual: 990 },
};

const TIER_FEATURES = [
  {
    name: 'Max SKUs',
    free: '500',
    starter: '5,000',
    professional: '50,000',
    enterprise: '250,000 default',
  },
  {
    name: 'Max Users',
    free: '1',
    starter: '3',
    professional: '10',
    enterprise: 'Contract limit',
  },
  {
    name: 'Active expiry entries',
    free: '500',
    starter: '5,000',
    professional: '50,000',
    enterprise: '250,000 default',
  },
  {
    name: 'Storage',
    free: '1 GB',
    starter: '10 GB',
    professional: '100 GB',
    enterprise: 'Contract limit',
  },
  {
    name: 'Advanced Analytics',
    free: false,
    starter: false,
    professional: true,
    enterprise: true,
  },
  {
    name: 'API Access',
    free: false,
    starter: true,
    professional: true,
    enterprise: true,
  },
  {
    name: 'Priority Support',
    free: false,
    starter: false,
    professional: true,
    enterprise: true,
  },
  {
    name: 'Dedicated Support',
    free: false,
    starter: false,
    professional: false,
    enterprise: true,
  },
];

export function UpgradeModal({ isOpen, onClose, onSelectPlan, currentTier }: UpgradeModalProps) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  if (!isOpen) return null;

  const tiers: LaunchTier[] = ['free', 'starter', 'professional', 'enterprise'];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        data-testid="upgrade-modal-content"
        className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto p-4 sm:p-6 sm:max-w-2xl lg:max-w-6xl"
      >
        <DialogHeader>
          <DialogTitle>Upgrade Your Plan</DialogTitle>
          <DialogDescription>
            Choose the plan that best fits your pharmacy's needs
          </DialogDescription>
        </DialogHeader>

        {/* Billing Cycle Toggle */}
        <div className="flex justify-center gap-2 my-4">
          <Button
            variant={billingCycle === 'monthly' ? 'default' : 'outline'}
            onClick={() => setBillingCycle('monthly')}
            size="sm"
          >
            Monthly
          </Button>
          <Button
            variant={billingCycle === 'annual' ? 'default' : 'outline'}
            onClick={() => setBillingCycle('annual')}
            size="sm"
          >
            Annual
            <span className="ml-2 text-xs bg-semantic-success text-semantic-success-foreground px-2 py-0.5 rounded-full">
              Save 17%
            </span>
          </Button>
        </div>

        {/* Tier Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {tiers.map((tier) => {
            const isCurrentTier = tier === currentTier;
            const isEnterprise = tier === 'enterprise';
            const pricing = isEnterprise ? null : TIER_PRICING[tier];
            const monthlyPrice = pricing
              ? pricing[billingCycle] / (billingCycle === 'annual' ? 12 : 1)
              : null;
            const annualBilledAmount = pricing?.annual;

            return (
              <Card
                key={tier}
                data-tier={tier}
                data-testid={`tier-card-${tier}`}
                className={`relative ${isCurrentTier ? 'border-semantic-primary border-2' : ''}`}
              >
                {isCurrentTier && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <span className="bg-semantic-primary text-semantic-primary-foreground text-xs px-3 py-1 rounded-full">
                      Current Plan
                    </span>
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-lg">
                    {tier.charAt(0).toUpperCase() + tier.slice(1)}
                  </CardTitle>
                  <CardDescription>
                    {isEnterprise ? (
                      <span className="text-2xl font-bold font-heading">Contact Sales</span>
                    ) : (
                      <>
                        <span className="text-3xl font-bold font-heading">A${monthlyPrice}</span>
                        <span className="text-sm text-muted-foreground">/month</span>
                        {billingCycle === 'annual' && annualBilledAmount !== undefined && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Billed A${annualBilledAmount} annually
                          </div>
                        )}
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    className="w-full mb-4"
                    disabled={isCurrentTier}
                    onClick={() => onSelectPlan(tier, billingCycle)}
                  >
                    {isCurrentTier ? 'Current Plan' : isEnterprise ? 'Contact Us' : 'Upgrade'}
                  </Button>
                  <ul className="space-y-2 text-sm">
                    {TIER_FEATURES.map((feature) => {
                      const value = feature[tier];
                      return (
                        <li key={feature.name} className="flex items-start gap-2">
                          {typeof value === 'boolean' ? (
                            value ? (
                              <span className="text-semantic-success">✓</span>
                            ) : (
                              <span className="text-semantic-text-muted">✗</span>
                            )
                          ) : (
                            <span className="text-semantic-secondary">•</span>
                          )}
                          <span className="flex-1">
                            <strong>{feature.name}:</strong>{' '}
                            {typeof value === 'boolean' ? '' : value}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Feature Comparison Table (Desktop) */}
        <div className="hidden lg:block mt-8">
          <h3 className="text-lg font-semibold font-heading mb-4">Feature Comparison</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3 font-semibold">Feature</th>
                  {tiers.map((tier) => (
                    <th key={tier} className="text-center p-3 font-semibold">
                      {tier.charAt(0).toUpperCase() + tier.slice(1)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TIER_FEATURES.map((feature) => (
                  <tr key={feature.name} className="border-b hover:bg-semantic-surface-2">
                    <td className="p-3 font-medium">{feature.name}</td>
                    {tiers.map((tier) => {
                      const value = feature[tier];
                      return (
                        <td key={tier} className="text-center p-3">
                          {typeof value === 'boolean' ? (
                            value ? (
                              <span className="text-semantic-success text-xl">✓</span>
                            ) : (
                              <span className="text-semantic-text-muted text-xl">✗</span>
                            )
                          ) : (
                            <span className="font-semibold">{value}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          <p>No-card 14-day Professional trial. Enterprise access is subject to fair-use limits.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
