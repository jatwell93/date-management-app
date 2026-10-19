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

  it('keeps white button labels and link text at AA contrast', () => {
    expect(buttonVariants({ variant: 'success' })).toContain('bg-semantic-success-strong');
    expect(buttonVariants({ variant: 'secondary' })).toContain('bg-semantic-secondary-strong');
    expect(buttonVariants({ variant: 'link' })).toContain('text-semantic-primary');
    expect(buttonVariants({ variant: 'link' })).not.toMatch(/\btext-semantic-secondary\b/);
  });

  it('keeps desktop density but gives touch pointers a 44px floor', () => {
    (['default', 'sm', 'lg', 'icon'] as const).forEach((size) => {
      expect(buttonVariants({ size })).toContain('pointer-coarse:min-h-11');
    });
    expect(buttonVariants({ size: 'icon' })).toContain('pointer-coarse:min-w-11');
    expect(buttonVariants({ size: 'default' })).toContain('h-9');

    render(<Input aria-label="quantity" />);
    const input = screen.getByLabelText('quantity');
    expect(input).toHaveClass('text-base', 'pointer-coarse:min-h-11');
    expect(input).not.toHaveClass('md:text-sm');
    // text-muted (#94A3B8) is 2.6:1; tertiary (#64748B) is 4.8:1.
    expect(input).toHaveClass('placeholder:text-semantic-text-tertiary');
  });

  it('renders badges at 14px', () => {
    expect(badgeVariants({ variant: 'inactive' })).toContain('text-sm');
    expect(badgeVariants({ variant: 'inactive' })).not.toContain('text-xs');
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
    ['success', 'bg-semantic-success-strong'],
    ['error', 'bg-semantic-critical'],
    ['warning', 'bg-semantic-warning-strong'],
    ['info', 'bg-semantic-secondary-strong'],
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
