// Service functions for expired items

import * as Sentry from '@sentry/react';
import { ExpiredItem, ProcessExpiredItemRequest, ExpiredItemTransaction } from '../types/inventory';

// Get all expired items
export const getExpiredItems = async (token: string | null): Promise<ExpiredItem[]> => {
  try {
    if (!token) {
      throw new Error('Authentication token not found');
    }

    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001'}/expired-items`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch expired items: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (error instanceof Error) {
      Sentry.captureException(error, {
        tags: { feature: 'expired-items' },
      });
    } else {
      Sentry.captureMessage('Error fetching expired items', {
        level: 'error',
        tags: { feature: 'expired-items' },
      });
    }
    throw error;
  }
};

// Process an expired item (mark as sold through or expired)
export const processExpiredItem = async (
  request: ProcessExpiredItemRequest,
  token: string | null,
): Promise<ExpiredItemTransaction> => {
  try {
    if (!token) {
      throw new Error('Authentication token not found');
    }

    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001'}/expired-items/process`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(request),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to process expired item: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (error instanceof Error) {
      Sentry.captureException(error, {
        tags: { feature: 'expired-items' },
      });
    } else {
      Sentry.captureMessage('Error processing expired item', {
        level: 'error',
        tags: { feature: 'expired-items' },
      });
    }
    throw error;
  }
};

// Get expired losses report
export const getExpiredLossesReport = async (
  token: string | null,
): Promise<{
  lossesBySKU: Array<{ sku: string; productName: string; totalLoss: number }>;
  lossesByStoreArea: Array<{ locationName: string; totalLoss: number }>;
}> => {
  try {
    if (!token) {
      throw new Error('Authentication token not found');
    }

    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001'}/expired-items/reports/expired-losses`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch expired losses report: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (error instanceof Error) {
      Sentry.captureException(error, {
        tags: { feature: 'expired-loss-report' },
      });
    } else {
      Sentry.captureMessage('Error fetching expired losses report', {
        level: 'error',
        tags: { feature: 'expired-loss-report' },
      });
    }
    throw error;
  }
};
