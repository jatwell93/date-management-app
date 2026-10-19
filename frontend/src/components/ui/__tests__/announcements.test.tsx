import { render, screen } from '@testing-library/react';

import Toast from '../toast';
import { ToastProvider } from '../toast-provider';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../dialog';

describe('toast announcements', () => {
  it.each(['success', 'info', 'warning'] as const)(
    'fills an already-mounted polite status region for %s toasts',
    (type) => {
      const { rerender } = render(
        <Toast message="Saved" type={type} isVisible={false} onClose={() => undefined} />,
      );

      const region = screen.getByTestId('toast-status-region');
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toBeEmptyDOMElement();
      // An idle region does not answer role queries meant for page content.
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      rerender(<Toast message="Saved" type={type} isVisible onClose={() => undefined} />);

      // Same node, now holding the message: announced as a change, not an insertion.
      expect(screen.getByRole('status')).toBe(region);
      expect(region).toHaveTextContent('Saved');
      expect(screen.getByTestId('toast-alert-region')).toBeEmptyDOMElement();
    },
  );

  it('fills an already-mounted assertive alert region for error toasts', () => {
    const { rerender } = render(
      <Toast message="Save failed" type="error" isVisible={false} onClose={() => undefined} />,
    );

    const region = screen.getByTestId('toast-alert-region');
    expect(region).toHaveAttribute('aria-live', 'assertive');
    expect(region).toBeEmptyDOMElement();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<Toast message="Save failed" type="error" isVisible onClose={() => undefined} />);

    expect(screen.getByRole('alert')).toBe(region);
    expect(region).toHaveTextContent('Save failed');
    expect(screen.getByTestId('toast-status-region')).toBeEmptyDOMElement();
  });

  it('keeps the regions mounted from ToastProvider start-up and never blocks clicks', () => {
    render(
      <ToastProvider>
        <p>Page</p>
      </ToastProvider>,
    );

    const status = screen.getByTestId('toast-status-region');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByTestId('toast-alert-region')).toHaveAttribute('aria-live', 'assertive');
    expect(status.parentElement).toHaveClass('pointer-events-none');
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
