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
      }, 3000); // Auto-hide after 3 seconds
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [isVisible]);

  const getToastStyle = () => {
    switch (type) {
      case 'success':
        return 'bg-inventory-success-500';
      case 'error':
        return 'bg-inventory-error-500';
      case 'warning':
        return 'bg-inventory-warning-500';
      case 'info':
      default:
        return 'bg-inventory-primary-500';
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
        <div className={`${getToastStyle()} text-white px-4 py-3 rounded-md shadow-lg flex items-center`}>
          <span>{message}</span>
          <button
            onClick={onClose}
            className="ml-4 text-white hover:text-white/80 focus:outline-none"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
  );
};

export default Toast;