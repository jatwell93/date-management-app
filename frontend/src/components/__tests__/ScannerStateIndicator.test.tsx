import React from 'react';
import { render, screen } from '@testing-library/react';
import { ScannerStateIndicator } from '../ScannerStateIndicator';

describe('ScannerStateIndicator', () => {
  it.each([
    ['ready', 'Ready to scan', 'scanner-state-ready'],
    ['scanning', 'Scanning...', 'scanner-state-scanning'],
    ['scanned', 'Item scanned', 'scanner-state-scanned'],
    ['warning', 'Warning: duplicate scan', 'scanner-state-warning'],
    ['error', 'Scan failed. Try again.', 'scanner-state-error'],
  ] as const)('renders the %s state', (state, label, testId) => {
    render(<ScannerStateIndicator state={state} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it('keeps a stable layout container across state changes', () => {
    const { rerender } = render(<ScannerStateIndicator state="ready" />);
    const indicator = screen.getByTestId('scanner-state-indicator');

    rerender(<ScannerStateIndicator state="scanned" />);

    expect(screen.getByTestId('scanner-state-indicator')).toBe(indicator);
    expect(indicator).toHaveClass('min-h-[72px]');
  });

  it('marks the scanning state for reduced-motion-safe styling', () => {
    render(<ScannerStateIndicator state="scanning" />);

    expect(screen.getByTestId('scanner-state-scanning')).toHaveClass('scanner-state-scanning');
  });
});
