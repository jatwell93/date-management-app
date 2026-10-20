import React, { createContext, useContext, useState, ReactNode } from 'react';
import Toast from './toast';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastContextType {
  showToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

interface ToastProviderProps {
  children: ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toast, setToast] = useState<{
    message: string;
    type: ToastType;
  } | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const showToast = (message: string, type: ToastType) => {
    setToast({ message, type });
    setIsVisible(true);
  };

  const hideToast = () => {
    setIsVisible(false);
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Always mounted so its live regions exist before the first message. */}
      <Toast
        message={toast?.message ?? ''}
        type={toast?.type ?? 'info'}
        isVisible={isVisible && toast !== null}
        onClose={hideToast}
      />
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
