import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { PlanComparison } from './PlanComparison';
import type { TierLevel } from '../types/subscription';
import type { LaunchTier } from '../lib/planCatalog';

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPlan: (tier: LaunchTier, billingCycle: 'monthly' | 'annual') => void;
  currentTier: TierLevel;
}

export function UpgradeModal({ isOpen, onClose, onSelectPlan, currentTier }: UpgradeModalProps) {
  if (!isOpen) return null;

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

        <PlanComparison currentTier={currentTier} onSelectPlan={onSelectPlan} />
      </DialogContent>
    </Dialog>
  );
}
