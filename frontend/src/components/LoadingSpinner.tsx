import React from 'react';

interface LoadingSpinnerProps {
  message?: string;
  className?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'Loading...',
  className = '',
}) => {
  return (
    <div role="status" className={`flex flex-col items-center justify-center ${className}`}>
      <div
        aria-hidden="true"
        className="animate-spin rounded-full size-12 border-t-2 border-b-2 border-primary mb-4"
      ></div>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
};

export default LoadingSpinner;
