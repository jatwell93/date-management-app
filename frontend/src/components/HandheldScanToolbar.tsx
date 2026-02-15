import React from 'react';
import { useHandheldDetectionContext } from '../contexts/HandheldContext';
import { HandheldScanToolbarProps } from '../types/handheld';
import { SyncStrategy } from '../config/handheld';

export const HandheldScanToolbar: React.FC<HandheldScanToolbarProps> = ({
  userName,
  syncStatus,
  onSyncNow,
  onSettingsClick,
  queueLength,
}) => {
  const { syncStrategy, setSyncStrategy } = useHandheldDetectionContext();
  const getSyncStatusText = () => {
    switch (syncStatus) {
      case 'syncing':
        return 'Syncing...';
      case 'synced':
        return 'Synced';
      case 'offline':
        return 'Offline';
      case 'failed':
        return 'Sync Failed';
      default:
        return 'Unknown';
    }
  };

  const getSyncStatusColor = () => {
    switch (syncStatus) {
      case 'syncing':
        return 'text-blue-600';
      case 'synced':
        return 'text-green-600';
      case 'offline':
        return 'text-yellow-600';
      case 'failed':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div
      data-testid="handheld-scan-toolbar"
      className="handheld-scan-toolbar sticky top-0 bg-white border-b border-gray-200 shadow-sm z-40"
    >
      <div className="px-4 py-3">
        {/* Top row: User name and sync status */}
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center space-x-2">
            {userName && <span className="text-sm font-medium text-gray-900">{userName}</span>}
            <div className={`text-sm font-medium ${getSyncStatusColor()}`}>
              {getSyncStatusText()}
            </div>
          </div>
          <button
            type="button"
            onClick={onSettingsClick}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>

        {/* Bottom row: Sync controls */}
        <div className="flex items-center space-x-3">
          <div className="flex-1">
            <label htmlFor="sync-strategy" className="block text-xs font-medium text-gray-700 mb-1">
              Sync Strategy
            </label>
            <select
              id="sync-strategy"
              data-testid="sync-strategy-selector"
              value={syncStrategy}
              onChange={(e) => setSyncStrategy(e.target.value as SyncStrategy)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[44px]"
            >
              <option value="real-time">Real-time</option>
              <option value="batch">Batch (10 min)</option>
              <option value="manual">Manual</option>
            </select>
          </div>

          <button
            type="button"
            data-testid="sync-now-button"
            onClick={onSyncNow}
            disabled={queueLength === 0}
            className={`px-4 py-2 text-sm font-medium rounded-md min-h-[44px] min-w-[80px] ${
              queueLength > 0
                ? 'bg-blue-600 hover:bg-blue-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Sync Now
            {queueLength > 0 && <span className="ml-1 text-xs">({queueLength})</span>}
          </button>
        </div>
      </div>
    </div>
  );
};
