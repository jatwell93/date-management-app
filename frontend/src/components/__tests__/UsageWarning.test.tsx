import { fireEvent, render, screen } from '@testing-library/react';
import { UsageWarning } from '../UsageWarning';

describe('UsageWarning', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders nothing below the threshold', () => {
    const { container } = render(<UsageWarning resourceType="skus" current={10} limit={100} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('names its buttons after the resource so repeated warnings are distinguishable', () => {
    render(
      <>
        <UsageWarning resourceType="skus" current={90} limit={100} onUpgrade={vi.fn()} />
        <UsageWarning resourceType="users" current={3} limit={3} onUpgrade={vi.fn()} />
      </>,
    );

    expect(screen.getByRole('button', { name: 'Upgrade for more SKUs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade for more Users' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss SKUs warning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss Users warning' })).toBeInTheDocument();
  });

  it('uses AA-contrast muted foreground tokens for the detail line', () => {
    render(<UsageWarning resourceType="users" current={3} limit={3} />);

    const detail = screen.getByText(/Using 3 of 3/);
    expect(detail).toHaveClass('text-sm', 'text-semantic-critical-muted-foreground');
    expect(detail).not.toHaveClass('text-xs');
    expect(detail).not.toHaveClass('text-semantic-critical');
  });

  it('still renders and dismisses when storage is blocked', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    render(<UsageWarning resourceType="skus" current={9000} limit={10000} />);

    expect(screen.getByText(/Using 9,000 of 10,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss SKUs warning' }));
    expect(screen.queryByText(/SKUs usage at 90%/)).not.toBeInTheDocument();

    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('hides the warning after dismissal', () => {
    render(<UsageWarning resourceType="skus" current={90} limit={100} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss SKUs warning' }));

    expect(screen.queryByText(/SKUs usage at 90%/)).not.toBeInTheDocument();
    expect(localStorage.getItem('usage-warning-dismissed-skus')).not.toBeNull();
  });
});
