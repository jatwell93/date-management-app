import { act, render, screen } from '@testing-library/react';

import { Button, buttonVariants } from '../button';
import { Badge, badgeVariants } from '../badge';
import { Card } from '../card';
import { Input } from '../input';
import { TableFooter, TableRow } from '../table';
import Toast from '../toast';

describe('phase 2 semantic UI primitives', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  it('uses semantic intent tokens for button variants', () => {
    expect(buttonVariants({ variant: 'default' })).toContain('bg-semantic-primary');
    expect(buttonVariants({ variant: 'secondary' })).toContain('bg-semantic-secondary');
    expect(buttonVariants({ variant: 'neutral' })).toContain('bg-semantic-surface-3');
    expect(buttonVariants({ variant: 'neutral' })).toContain('text-semantic-text-primary');
    expect(buttonVariants({ variant: 'success' })).toContain('bg-semantic-success');
    expect(buttonVariants({ variant: 'warning' })).toContain('bg-semantic-warning');
    expect(buttonVariants({ variant: 'warning' })).toContain('bg-semantic-warning-hover');
    expect(buttonVariants({ variant: 'error' })).toContain('bg-semantic-critical');
  });

  it('uses semantic focus and validation tokens for text inputs', () => {
    render(<Input aria-label="email" />);

    expect(screen.getByLabelText('email')).toHaveClass('focus-visible:border-semantic-primary');
    expect(screen.getByLabelText('email')).toHaveClass('focus-visible:ring-semantic-primary/50');
    expect(screen.getByLabelText('email')).toHaveClass('aria-invalid:border-semantic-critical');
  });

  it('uses semantic surface tokens for structural components', () => {
    render(
      <>
        <Card data-testid="card" />
        <table>
          <tbody>
            <TableRow data-testid="row" />
          </tbody>
          <TableFooter data-testid="footer" />
        </table>
      </>,
    );

    expect(screen.getByTestId('card')).toHaveClass('bg-semantic-surface-1');
    expect(screen.getByTestId('row')).toHaveClass('hover:bg-semantic-surface-2');
    expect(screen.getByTestId('footer')).toHaveClass('bg-semantic-surface-2');
  });

  it.each([
    ['success', 'bg-semantic-success'],
    ['error', 'bg-semantic-critical'],
    ['warning', 'bg-semantic-warning'],
    ['info', 'bg-semantic-secondary'],
  ] as const)('uses semantic %s token for toast variants', (type, className) => {
    render(<Toast message={`${type} toast`} type={type} isVisible onClose={() => undefined} />);

    expect(screen.getByText(`${type} toast`).parentElement).toHaveClass(className);
  });

  it('resets the auto-hide timer when visible toast content changes', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { rerender } = render(
      <Toast message="First toast" type="success" isVisible onClose={onClose} />,
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    rerender(<Toast message="Second toast" type="error" isVisible onClose={onClose} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Second toast')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps shared button rendering available after token migration', () => {
    render(<Button>Continue</Button>);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass('cursor-pointer');
  });

  it('keeps disabled shared buttons readable with semantic tokens', () => {
    render(<Button disabled>Continue</Button>);

    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass(
      'disabled:cursor-not-allowed',
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass(
      'disabled:bg-semantic-surface-4',
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass(
      'disabled:text-semantic-text-tertiary',
    );
  });

  it('provides semantic badge variants for shared status labels', () => {
    expect(badgeVariants({ variant: 'active' })).toContain('bg-semantic-success-muted');
    expect(badgeVariants({ variant: 'inactive' })).toContain('bg-semantic-surface-3');
    expect(badgeVariants({ variant: 'pending' })).toContain('bg-semantic-warning-muted');
    expect(badgeVariants({ variant: 'success' })).toContain('bg-semantic-success-muted');
    expect(badgeVariants({ variant: 'error' })).toContain('bg-semantic-critical-muted');

    render(<Badge variant="pending">Pending</Badge>);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });
});
