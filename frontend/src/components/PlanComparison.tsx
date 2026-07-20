import { useState } from 'react';
import { Check, X, Minus } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import type { TierLevel } from '../types/subscription';
import {
  LAUNCH_TIERS,
  TIER_FEATURES,
  formatPrice,
  getTierPricing,
  tierDisplayName,
  tierRank,
  type BillingCycle,
  type LaunchTier,
} from '../lib/planCatalog';

interface PlanComparisonProps {
  currentTier: TierLevel;
  onSelectPlan: (tier: LaunchTier, billingCycle: BillingCycle) => void;
  /** Controlled billing cycle. Omit to let the component manage its own. */
  billingCycle?: BillingCycle;
  onBillingCycleChange?: (cycle: BillingCycle) => void;
  defaultBillingCycle?: BillingCycle;
  /** Tier whose checkout is mid-flight — renders a "Processing..." button. */
  busyTier?: LaunchTier | null;
  className?: string;
}

function FeatureValue({ value }: { value: boolean | string }) {
  if (typeof value === 'boolean') {
    return value ? (
      <Check className="size-4 text-semantic-success" aria-label="Included" />
    ) : (
      <X className="size-4 text-semantic-text-muted" aria-label="Not included" />
    );
  }
  return <Minus className="size-4 text-semantic-secondary" aria-hidden="true" />;
}

export function PlanComparison({
  currentTier,
  onSelectPlan,
  billingCycle: controlledCycle,
  onBillingCycleChange,
  defaultBillingCycle = 'monthly',
  busyTier = null,
  className,
}: PlanComparisonProps) {
  const [internalCycle, setInternalCycle] = useState<BillingCycle>(defaultBillingCycle);
  const billingCycle = controlledCycle ?? internalCycle;

  const setBillingCycle = (cycle: BillingCycle) => {
    if (controlledCycle === undefined) {
      setInternalCycle(cycle);
    }
    onBillingCycleChange?.(cycle);
  };

  const currentRank = tierRank(currentTier);

  return (
    <div className={className}>
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
        {LAUNCH_TIERS.map((tier) => {
          const isCurrentTier = tier === currentTier;
          const isDowngrade = tierRank(tier) < currentRank;
          const isEnterprise = tier === 'enterprise';
          const pricing = getTierPricing(tier, billingCycle);
          const isBusy = busyTier === tier;

          // Featured tier: the first self-serve upgrade above the current plan.
          const isFeatured =
            !isCurrentTier && !isDowngrade && !isEnterprise && tierRank(tier) === currentRank + 1;

          const cardEmphasis = isCurrentTier
            ? 'border-semantic-primary border-2'
            : isFeatured
              ? 'bg-semantic-surface-2 border-semantic-border-strong'
              : '';

          let buttonLabel: string;
          if (isCurrentTier) buttonLabel = 'Current Plan';
          else if (isDowngrade) buttonLabel = 'Included';
          else if (isEnterprise) buttonLabel = 'Contact Us';
          else if (isBusy) buttonLabel = 'Processing...';
          else buttonLabel = 'Upgrade';

          const canCheckout = !isCurrentTier && !isDowngrade && !isEnterprise;

          return (
            <Card
              key={tier}
              data-tier={tier}
              data-testid={`tier-card-${tier}`}
              className={`relative ${cardEmphasis} ${isDowngrade ? 'opacity-60' : ''}`}
            >
              {isCurrentTier && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <span className="bg-semantic-primary text-semantic-primary-foreground text-xs px-3 py-1 rounded-full">
                    Current Plan
                  </span>
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-lg">{tierDisplayName(tier)}</CardTitle>
                <CardDescription>
                  {pricing.isContactSales ? (
                    <span className="text-2xl font-bold font-heading">Contact Sales</span>
                  ) : (
                    <>
                      <span className="text-3xl font-bold font-heading tabular-nums">
                        A${formatPrice(pricing.monthlyEquivalent ?? 0)}
                      </span>
                      <span className="text-sm text-muted-foreground">/month</span>
                      {billingCycle === 'annual' && pricing.annualBilled !== null && (
                        <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                          Billed A${formatPrice(pricing.annualBilled)} annually
                        </div>
                      )}
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className="w-full mb-4"
                  variant={isFeatured ? 'default' : 'outline'}
                  disabled={!canCheckout || isBusy}
                  onClick={() => canCheckout && onSelectPlan(tier, billingCycle)}
                >
                  {buttonLabel}
                </Button>
                <ul className="space-y-2 text-sm">
                  {TIER_FEATURES.map((feature) => {
                    const value = feature[tier];
                    return (
                      <li key={feature.name} className="flex items-start gap-2">
                        <FeatureValue value={value} />
                        <span className="flex-1">
                          <strong>{feature.name}:</strong> {typeof value === 'boolean' ? '' : value}
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
                {LAUNCH_TIERS.map((tier) => (
                  <th key={tier} className="text-center p-3 font-semibold">
                    {tierDisplayName(tier)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIER_FEATURES.map((feature) => (
                <tr key={feature.name} className="border-b hover:bg-semantic-surface-2">
                  <td className="p-3 font-medium">{feature.name}</td>
                  {LAUNCH_TIERS.map((tier) => {
                    const value = feature[tier];
                    return (
                      <td key={tier} className="p-3">
                        <div className="flex justify-center">
                          {typeof value === 'boolean' ? (
                            <FeatureValue value={value} />
                          ) : (
                            <span className="font-semibold tabular-nums">{value}</span>
                          )}
                        </div>
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
    </div>
  );
}
