import React from 'react';
import { Button } from '../ui/button';
import type { LastUploadSummary } from '../../types/upload';
import type { UploadImportType } from '../../utils/csvValidator';
import { formatCount } from './formatCount';

const ReviewBrandMatchesAction: React.FC<{
  importType: UploadImportType;
  onReview: () => void;
}> = ({ importType, onReview }) => {
  if (importType !== 'product-catalog') return null;
  return (
    <div className="mt-3 sm:col-span-2">
      <Button type="button" onClick={onReview} className="min-h-11">
        Review brand matches
      </Button>
    </div>
  );
};

export const LastUploadSummaryCard: React.FC<{
  summary: LastUploadSummary | null;
  onReviewBrandMatches: () => void;
}> = ({ summary, onReviewBrandMatches }) => {
  const isExpiry = summary?.importType === 'expiry-list';
  return (
    <div className="mb-6 p-4 bg-semantic-surface-2 rounded-md border border-hairline">
      <h2 className="text-lg font-medium text-semantic-text-primary mb-2">Last uploaded file</h2>
      {summary ? (
        <div className="grid gap-1 text-sm text-semantic-text-secondary sm:grid-cols-2">
          <p className="font-medium text-semantic-text-primary">{summary.fileName}</p>
          <p>{isExpiry ? 'Expiry list' : 'Product catalog'}</p>
          <p>Completed</p>
          <p>
            {isExpiry ? 'Rows imported' : 'Products imported'}: {formatCount(summary.importedCount)}
          </p>
          <p>
            {isExpiry ? 'Rows merged' : 'Products updated'}: {formatCount(summary.updatedCount)}
          </p>
          <p>Rows rejected: {formatCount(summary.rejectedCount)}</p>
          <ReviewBrandMatchesAction
            importType={summary.importType}
            onReview={onReviewBrandMatches}
          />
        </div>
      ) : (
        <p className="text-sm text-semantic-text-secondary">No completed uploads yet.</p>
      )}
    </div>
  );
};
