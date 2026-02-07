import React, { useState, useEffect } from 'react';
import './StorageQuotaWarning.css';

/**
 * Storage Quota Warning Modal Component
 * Displays when user's storage usage exceeds 80% of their plan limit
 * 
 * Usage:
 * <StorageQuotaWarning
 *   userId={123}
 *   subscriptionTier="free"
 *   onUpgrade={() => navigateToUpgrade()}
 *   onDismiss={() => setShowWarning(false)}
 * />
 */

interface StorageQuotaInfo {
  used: number;
  limit: number;
  percentageUsed: number;
  tier: string;
  displayLimit: string;
  warningThreshold: number;
  isWarning: boolean;
}

interface StorageQuotaWarningProps {
  userId: number;
  subscriptionTier?: 'free' | 'pro' | 'enterprise';
  onUpgrade?: () => void;
  onDismiss?: () => void;
  autoHideDays?: number; // Days before showing warning again (default 7)
}

export const StorageQuotaWarning: React.FC<StorageQuotaWarningProps> = ({
  userId,
  subscriptionTier = 'free',
  onUpgrade,
  onDismiss,
  autoHideDays = 7,
}) => {
  const [quota, setQuota] = useState<StorageQuotaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Fetch storage quota on component mount
  useEffect(() => {
    const fetchQuota = async () => {
      try {
        const authToken = localStorage.getItem('authToken');
        if (!authToken) {
          setDismissed(true);
          return;
        }

        const response = await fetch(`/api/storage-quota/${userId}?tier=${subscriptionTier}`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch storage quota');
        }

        const data: StorageQuotaInfo = await response.json();
        setQuota(data);

        // Check if warning should be shown
        if (data.isWarning) {
          // Check if user has dismissed recently
          const lastDismissed = localStorage.getItem(
            `storage-quota-dismissed-${userId}`
          );
          if (!lastDismissed) {
            setDismissed(false);
          } else {
            const dismissedDate = new Date(lastDismissed);
            const now = new Date();
            const daysSinceDismiss =
              (now.getTime() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);

            if (daysSinceDismiss < autoHideDays) {
              setDismissed(true);
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchQuota();
  }, [userId, subscriptionTier, autoHideDays]);

  // Handle dismiss
  const handleDismiss = () => {
    localStorage.setItem(`storage-quota-dismissed-${userId}`, new Date().toISOString());
    setDismissed(true);
    onDismiss?.();
  };

  // Don't show if dismissed, loading, error, or no warning
  if (dismissed || loading || error || !quota || !quota.isWarning) {
    return null;
  }

  // Format remaining storage
  const remainingBytes = quota.limit - quota.used;
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="storage-quota-warning">
      <div className="storage-quota-warning__overlay" onClick={handleDismiss} />
      
      <div className="storage-quota-warning__modal">
        <div className="storage-quota-warning__header">
          <h2>Storage Quota Warning</h2>
          <button
            className="storage-quota-warning__close"
            onClick={handleDismiss}
            aria-label="Close warning"
          >
            ✕
          </button>
        </div>

        <div className="storage-quota-warning__content">
          <div className="storage-quota-warning__icon">⚠️</div>
          
          <p className="storage-quota-warning__message">
            You're using <strong>{quota.percentageUsed}%</strong> of your storage quota
          </p>

          {/* Progress bar */}
          <div className="storage-quota-warning__progress">
            <div className="storage-quota-warning__progress-bar">
              <div
                className="storage-quota-warning__progress-fill"
                style={{ width: `${Math.min(quota.percentageUsed, 100)}%` }}
              />
            </div>
            <div className="storage-quota-warning__progress-text">
              <span>{formatBytes(quota.used)}</span>
              <span>{quota.displayLimit}</span>
            </div>
          </div>

          <p className="storage-quota-warning__details">
            {remainingBytes > 0 ? (
              <>You have <strong>{formatBytes(remainingBytes)}</strong> of storage remaining.</>
            ) : (
              <>You have reached your storage limit. Upgrade your plan to continue uploading.</>
            )}
          </p>

          <div className="storage-quota-warning__tier-info">
            <p>Current Plan: <strong>{quota.tier.charAt(0).toUpperCase() + quota.tier.slice(1)}</strong></p>
          </div>
        </div>

        <div className="storage-quota-warning__actions">
          {onUpgrade && (
            <button
              className="storage-quota-warning__button storage-quota-warning__button--primary"
              onClick={onUpgrade}
            >
              Upgrade Plan
            </button>
          )}
          
          <button
            className="storage-quota-warning__button storage-quota-warning__button--secondary"
            onClick={handleDismiss}
          >
            Remind Me Later
          </button>
        </div>

        <p className="storage-quota-warning__footer">
          We'll remind you again in {autoHideDays} days. You can manage your storage by deleting old uploads.
        </p>
      </div>
    </div>
  );
};

export default StorageQuotaWarning;
