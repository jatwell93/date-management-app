import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  isVisible: boolean;
  onClose: () => void;
}

// -strong fills keep the white message at AA (sky, green and amber DEFAULTs fail).
const TOAST_STYLES: Record<ToastType, string> = {
  success: 'bg-semantic-success-strong text-semantic-success-foreground',
  error: 'bg-semantic-critical text-semantic-critical-foreground',
  warning: 'bg-semantic-warning-strong text-semantic-warning-foreground',
  info: 'bg-semantic-secondary-strong text-semantic-secondary-foreground',
};

function ToastCard({ message, type, onClose }: Omit<ToastProps, 'isVisible'>) {
  return (
    <div className="pointer-events-auto transform transition-transform duration-300 ease-in-out translate-y-0 opacity-100">
      <div
        className={`${TOAST_STYLES[type] ?? TOAST_STYLES.info} pl-4 pr-1 py-1 rounded-md shadow-lg flex items-center gap-2`}
      >
        <span className="py-2">{message}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss notification"
          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-xl leading-none transition-opacity hover:opacity-80 outline-hidden focus-visible:ring-2 focus-visible:ring-current"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
    </div>
  );
}

const Toast: React.FC<ToastProps> = ({ message, type, isVisible, onClose }) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isVisible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: imperative show + auto-hide timer driven by the isVisible prop
      setShow(true);
      const timer = setTimeout(() => {
        setShow(false);
        onClose();
      }, 3000); // Auto-hide after 3 seconds
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [isVisible, message, onClose, type]);

  // Both live regions (aria-live) stay mounted and empty while hidden: screen readers
  // announce text added to an existing region, but can miss a region inserted already
  // filled. Errors interrupt (assertive, role="alert"); everything else waits its turn
  // (polite, role="status"). The role is only set while the region holds a message, so
  // an idle empty region never answers getByRole('alert'/'status') for page content.
  const isError = type === 'error';
  const card = show ? <ToastCard message={message} type={type} onClose={onClose} /> : null;
  const statusCard = isError ? null : card;
  const alertCard = isError ? card : null;

  // Portalled to <body>: an open Radix modal aria-hides the app root, and a toast first
  // mounted while one is open (an ExpiredItemsPage error) would sit in that hidden subtree.
  // pointer-events-none: the empty fixed container never blocks clicks beneath it.
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-50">
      <div
        role={statusCard ? 'status' : undefined}
        aria-live="polite"
        aria-atomic="true"
        data-testid="toast-status-region"
      >
        {statusCard}
      </div>
      <div
        role={alertCard ? 'alert' : undefined}
        aria-live="assertive"
        aria-atomic="true"
        data-testid="toast-alert-region"
      >
        {alertCard}
      </div>
    </div>,
    document.body,
  );
};

export default Toast;
