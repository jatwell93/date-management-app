import React, { useEffect, useState } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  isVisible: boolean;
  onClose: () => void;
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

  const getToastStyle = () => {
    switch (type) {
      case 'success':
        return 'bg-semantic-success';
      case 'error':
        return 'bg-semantic-critical';
      case 'warning':
        return 'bg-semantic-warning';
      case 'info':
      default:
        return 'bg-semantic-secondary';
    }
  };

  const getToastTextStyle = () => {
    switch (type) {
      case 'success':
        return 'text-semantic-success-foreground';
      case 'error':
        return 'text-semantic-critical-foreground';
      case 'warning':
        return 'text-semantic-warning-foreground';
      case 'info':
      default:
        return 'text-semantic-secondary-foreground';
    }
  };

  if (!show) return null;

  // Errors interrupt (role="alert"); everything else waits its turn (role="status").
  const isError = type === 'error';

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={`transform transition-transform duration-300 ease-in-out ${
          show ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
        }`}
      >
        <div
          role={isError ? 'alert' : 'status'}
          aria-live={isError ? 'assertive' : 'polite'}
          aria-atomic="true"
          className={`${getToastStyle()} ${getToastTextStyle()} pl-4 pr-1 py-1 rounded-md shadow-lg flex items-center gap-2`}
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
    </div>
  );
};

export default Toast;
