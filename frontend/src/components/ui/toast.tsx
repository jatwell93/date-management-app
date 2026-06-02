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

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={`transform transition-transform duration-300 ease-in-out ${
          show ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
        }`}
      >
        <div
          className={`${getToastStyle()} ${getToastTextStyle()} px-4 py-3 rounded-md shadow-lg flex items-center`}
        >
          <span>{message}</span>
          <button
            onClick={onClose}
            className="ml-4 opacity-100 transition-opacity hover:opacity-80 focus:outline-none"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
  );
};

export default Toast;
