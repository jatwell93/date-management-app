import { render, screen } from '@testing-library/react';

import Toast from '../toast';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../dialog';

describe('toast announcements', () => {
  it.each(['success', 'info', 'warning'] as const)(
    'announces %s toasts politely through a status region',
    (type) => {
      render(<Toast message="Saved" type={type} isVisible onClose={() => undefined} />);

      const region = screen.getByRole('status');
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveTextContent('Saved');
    },
  );

  it('announces error toasts through an alert region', () => {
    render(<Toast message="Save failed" type="error" isVisible onClose={() => undefined} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('names the dismiss control and gives it a 44px target', () => {
    const onClose = vi.fn();
    render(<Toast message="Saved" type="success" isVisible onClose={onClose} />);

    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    expect(dismiss).toHaveClass('size-11');
    expect(dismiss).toHaveClass('focus-visible:ring-2');
    dismiss.click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('dialog close button', () => {
  it('is named Close and meets the 44px touch floor', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Edit area</DialogTitle>
          <DialogDescription>Change the area name.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveClass('size-11');
    expect(close).toHaveClass('text-semantic-text-secondary');
    expect(close).not.toHaveClass('opacity-70');
  });
});
