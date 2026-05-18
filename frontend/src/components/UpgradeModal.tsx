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

const TIER_PRICING: Record<Exclude<TierLevel, 'concierge'>, TierPricing> = {
  starter: { monthly: 99, annual: 990 },
  professional: { monthly: 249, annual: 2490 },
  premium: { monthly: 499, annual: 4990 },
};

const TIER_FEATURES = [
  {
    name: 'Max SKUs',
    starter: '500',
    professional: '2,000',
    premium: 'Unlimited',
    concierge: 'Unlimited',
  },
  {
    name: 'Max Users',
    starter: '1',
    professional: '3',
    premium: '10',
    concierge: '10',
  },
  {
    name: 'Max Inventory Items',
    starter: '5,000',
    professional: 'Unlimited',
    premium: 'Unlimited',
    concierge: 'Unlimited',
  },
  {
    name: 'Storage',
    starter: '10 GB',
    professional: '50 GB',
    premium: '200 GB',
    concierge: '500 GB',
  },
  {
    name: 'Advanced Analytics',
    starter: false,
    professional: false,
    premium: true,
    concierge: true,
  },
  {
    name: 'API Access',
    starter: false,
    professional: true,
    premium: true,
    concierge: true,
  },
  {
    name: 'Priority Support',
    starter: false,
    professional: false,
    premium: true,
    concierge: true,
  },
  {
    name: 'Dedicated Support',
    starter: false,
    professional: false,
    premium: false,
    concierge: true,
  },
];

export function UpgradeModal({ isOpen, onClose, onSelectPlan, currentTier }: UpgradeModalProps) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  if (!isOpen) return null;

  const tiers: TierLevel[] = ['starter', 'professional', 'premium', 'concierge'];

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
            <span className="ml-2 text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">
              Save 17%
            </span>
          </Button>
        </div>

        {/* Tier Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {tiers.map((tier) => {
            const isCurrentTier = tier === currentTier;
            const isConcierge = tier === 'concierge';
            const pricing = isConcierge ? null : TIER_PRICING[tier];
            const monthlyPrice = pricing
              ? pricing[billingCycle] / (billingCycle === 'annual' ? 12 : 1)
              : null;
            const annualBilledAmount = pricing?.annual;

            return (
              <Card
                key={tier}
                data-tier={tier}
                data-testid={`tier-card-${tier}`}
                className={`relative ${isCurrentTier ? 'border-blue-500 border-2' : ''}`}
              >
                {isCurrentTier && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <span className="bg-blue-500 text-white text-xs px-3 py-1 rounded-full">
                      Current Plan
                    </span>
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-lg">
                    {tier.charAt(0).toUpperCase() + tier.slice(1)}
                  </CardTitle>
                  <CardDescription>
                    {isConcierge ? (
                      <span className="text-2xl font-bold font-heading">Contact Sales</span>
                    ) : (
                      <>
                        <span className="text-3xl font-bold font-heading">${monthlyPrice}</span>
                        <span className="text-sm text-muted-foreground">/month</span>
                        {billingCycle === 'annual' && annualBilledAmount !== undefined && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Billed ${annualBilledAmount} annually
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
                    {isCurrentTier ? 'Current Plan' : isConcierge ? 'Contact Us' : 'Upgrade'}
                  </Button>
                  <ul className="space-y-2 text-sm">
                    {TIER_FEATURES.map((feature) => {
                      const value = feature[tier];
                      return (
                        <li key={feature.name} className="flex items-start gap-2">
                          {typeof value === 'boolean' ? (
                            value ? (
                              <span className="text-green-500">✓</span>
                            ) : (
                              <span className="text-gray-300">✗</span>
                            )
                          ) : (
                            <span className="text-blue-500">•</span>
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
                  <tr key={feature.name} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-medium">{feature.name}</td>
                    {tiers.map((tier) => {
                      const value = feature[tier];
                      return (
                        <td key={tier} className="text-center p-3">
                          {typeof value === 'boolean' ? (
                            value ? (
                              <span className="text-green-500 text-xl">✓</span>
                            ) : (
                              <span className="text-gray-300 text-xl">✗</span>
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
          <p>All plans include 14-day free trial. Cancel anytime.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
