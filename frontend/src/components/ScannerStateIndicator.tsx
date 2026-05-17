import React from 'react';

export type ScannerState = 'ready' | 'scanning' | 'scanned' | 'warning' | 'error';

interface ScannerStateIndicatorProps {
  state: ScannerState;
}

const stateConfig: Record<
  ScannerState,
  {
    label: string;
    className: string;
    icon: React.ReactNode;
  }
> = {
  ready: {
    label: 'Ready to scan',
    className: 'bg-semantic-secondary-muted text-semantic-secondary-muted-foreground',
    icon: <span aria-hidden="true">○</span>,
  },
  scanning: {
    label: 'Scanning...',
    className:
      'scanner-state-scanning bg-semantic-primary-muted text-semantic-primary-muted-foreground',
    icon: <span aria-hidden="true">◌</span>,
  },
  scanned: {
    label: 'Item scanned',
    className: 'bg-semantic-success-muted text-semantic-success-muted-foreground',
    icon: <span aria-hidden="true">✓</span>,
  },
  warning: {
    label: 'Warning: duplicate scan',
    className: 'bg-semantic-warning-muted text-semantic-warning-muted-foreground',
    icon: <span aria-hidden="true">⚠</span>,
  },
  error: {
    label: 'Scan failed. Try again.',
    className: 'bg-semantic-critical-muted text-semantic-critical-muted-foreground',
    icon: <span aria-hidden="true">×</span>,
  },
};

export function ScannerStateIndicator({ state }: ScannerStateIndicatorProps) {
  const config = stateConfig[state];

  return (
    <div
      data-testid="scanner-state-indicator"
      role="status"
      aria-live="polite"
      className="min-h-[72px] flex items-center"
    >
      <div
        data-testid={`scanner-state-${state}`}
        className={`w-full rounded-lg border border-current/20 px-4 py-3 flex items-center gap-3 ${config.className}`}
      >
        <span className="text-lg leading-none">{config.icon}</span>
        <span className="font-medium">{config.label}</span>
      </div>
    </div>
  );
}
