import React from 'react';

/**
 * Upload progress: only the stage message is a live region, so screen readers hear
 * "Uploading file" once rather than every 5% tick. The bar carries the percentage.
 */
export const UploadProgress: React.FC<{ progress: number; message: string }> = ({
  progress,
  message,
}) => (
  <div className="mb-4">
    <div className="flex items-center justify-between mb-1">
      <span
        role="status"
        aria-label="Upload status"
        className="text-sm font-medium text-semantic-text-secondary"
      >
        {message}
      </span>
      <span
        aria-hidden="true"
        className="text-sm font-medium tabular-nums text-semantic-text-secondary"
      >
        {progress}%
      </span>
    </div>
    <div
      role="progressbar"
      aria-label="Upload progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      aria-valuetext={message ? `${progress}% - ${message}` : `${progress}%`}
      className="w-full overflow-hidden bg-semantic-surface-3 rounded-full h-2.5"
    >
      <div
        className="h-2.5 w-full origin-left rounded-full bg-semantic-primary transition-transform duration-300 ease-out"
        style={{ transform: `scaleX(${progress / 100})` }}
      ></div>
    </div>
  </div>
);
