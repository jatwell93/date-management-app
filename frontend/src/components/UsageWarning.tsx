import { useState, useEffect } from 'react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';

interface UsageWarningProps {
  resourceType: 'skus' | 'users' | 'storage' | 'inventoryItems';
  current: number;
  limit: number;
  threshold?: number;
  onUpgrade?: () => void;
  formatValue?: (value: number) => string;
}

export function UsageWarning({
  resourceType,
  current,
  limit,
  threshold = 80,
  onUpgrade,
  formatValue,
}: UsageWarningProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const dismissedKey = `usage-warning-dismissed-${resourceType}`;
    const lastDismissed = localStorage.getItem(dismissedKey);

    if (lastDismissed) {
      const dismissedDate = new Date(lastDismissed);
      const now = new Date();
      const hoursSinceDismiss = (now.getTime() - dismissedDate.getTime()) / (1000 * 60 * 60);

      if (hoursSinceDismiss < 24) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: restores dismissed state from localStorage; effect re-runs per resourceType
        setDismissed(true);
      }
    }
  }, [resourceType]);

  // Guard against invalid limit values
  if (limit <= 0 || !Number.isFinite(limit)) {
    return null;
  }

  const percentage = (current / limit) * 100;
  const isWarning = percentage >= threshold;

  const handleDismiss = () => {
    const dismissedKey = `usage-warning-dismissed-${resourceType}`;
    localStorage.setItem(dismissedKey, new Date().toISOString());
    setDismissed(true);
  };

  if (!isWarning || dismissed) {
    return null;
  }

  const resourceNames = {
    skus: 'SKUs',
    users: 'Users',
    storage: 'Storage',
    inventoryItems: 'Inventory Items',
  };

  const displayCurrent = formatValue ? formatValue(current) : current.toLocaleString();
  const displayLimit = formatValue ? formatValue(limit) : limit.toLocaleString();
  const remaining = limit - current;
  const displayRemaining = formatValue ? formatValue(remaining) : remaining.toLocaleString();

  const isUrgent = percentage >= 95;

  return (
    <Card
      className={`${
        isUrgent
          ? 'bg-semantic-critical-muted border-semantic-critical-muted'
          : 'bg-semantic-warning-muted border-semantic-warning-muted'
      }`}
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-1">
            <div
              className={`w-2 h-2 rounded-full ${isUrgent ? 'bg-semantic-critical' : 'bg-semantic-warning'}`}
            />
            <div className="flex-1">
              <p
                className={`text-sm font-medium ${
                  isUrgent
                    ? 'text-semantic-critical-muted-foreground'
                    : 'text-semantic-warning-muted-foreground'
                }`}
              >
                {isUrgent ? 'Critical: ' : 'Warning: '}
                {resourceNames[resourceType]} usage at {Math.round(percentage)}%
              </p>
              <p
                className={`text-xs ${
                  isUrgent ? 'text-semantic-critical' : 'text-semantic-warning'
                }`}
              >
                Using {displayCurrent} of {displayLimit} ({displayRemaining} remaining)
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {onUpgrade && (
              <Button
                size="sm"
                onClick={onUpgrade}
                className={
                  isUrgent
                    ? 'bg-semantic-critical hover:bg-semantic-critical-hover text-semantic-critical-foreground'
                    : 'bg-semantic-warning-hover hover:bg-semantic-warning-active text-semantic-warning-foreground'
                }
              >
                Upgrade
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={handleDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
