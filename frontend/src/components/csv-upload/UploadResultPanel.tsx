import React, { useState } from 'react';
import { Button } from '../ui/button';
import type { UploadResponse } from '../../types/upload';
import { withOccurrenceKeys } from '../../utils/listKeys';
import { formatCount } from './formatCount';

interface UploadResultPanelProps {
  uploadResult: UploadResponse;
  isExpiryImport: boolean;
  returnUrl: string | null;
  formatGuidelinesId: string;
  onShowGuidelines: () => void;
  onDownloadErrorReport: (reportUrl: string) => Promise<boolean>;
  onContinue: (returnUrl: string) => void;
}

const ErrorReportButton: React.FC<{
  reportUrl: string;
  onDownload: (reportUrl: string) => Promise<boolean>;
}> = ({ reportUrl, onDownload }) => {
  const [failed, setFailed] = useState(false);
  const handleClick = async () => {
    setFailed(false);
    setFailed(!(await onDownload(reportUrl)));
  };
  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className="mt-3 min-h-11 text-sm font-medium underline underline-offset-2"
      >
        Download full error report
      </button>
      {failed && (
        <p role="alert" className="mt-1 text-sm font-medium">
          The error report could not be downloaded. Please try again.
        </p>
      )}
    </>
  );
};

const isSafeReturnUrl = (returnUrl: string | null): returnUrl is string =>
  typeof returnUrl === 'string' &&
  returnUrl.startsWith('/') &&
  !returnUrl.startsWith('//') &&
  !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(returnUrl);

type CountRow = { label: string; value: string };

const countRow = (label: string, value: number | undefined): CountRow[] =>
  value === undefined ? [] : [{ label, value: formatCount(value) }];

const expiryCountRows = (result: UploadResponse): CountRow[] => [
  ...countRow('Rows imported', result.importedCount),
  ...countRow('Rows merged', result.mergedCount ?? result.updatedCount ?? 0),
];

const productCountRows = (result: UploadResponse): CountRow[] => [
  ...countRow('Products imported', result.importedCount),
  ...countRow('Products updated', result.updatedCount),
  ...countRow('Products unchanged', result.unchangedCount),
];

const hasRejectedOrSkipped = (result: UploadResponse): boolean =>
  result.rejectedCount !== undefined || result.skippedCount !== undefined;

const processedRow = (result: UploadResponse): CountRow[] => {
  if (result.processedCount === undefined) return [];
  const total = result.totalCount !== undefined ? ` / ${formatCount(result.totalCount)}` : '';
  return [{ label: 'Rows processed', value: `${formatCount(result.processedCount)}${total}` }];
};

const sharedCountRows = (result: UploadResponse, isExpiryImport: boolean): CountRow[] => [
  ...countRow('Errors', result.errorCount),
  ...(hasRejectedOrSkipped(result)
    ? countRow(
        isExpiryImport ? 'Rows rejected' : 'Rows skipped',
        result.rejectedCount ?? result.skippedCount ?? 0,
      )
    : []),
  ...processedRow(result),
];

const ResultCounts: React.FC<{ uploadResult: UploadResponse; isExpiryImport: boolean }> = ({
  uploadResult,
  isExpiryImport,
}) => {
  if (uploadResult.importedCount === undefined && uploadResult.processedCount === undefined) {
    return null;
  }
  const rows = [
    ...(isExpiryImport ? expiryCountRows(uploadResult) : productCountRows(uploadResult)),
    ...sharedCountRows(uploadResult, isExpiryImport),
  ];
  return (
    <div className="mt-2">
      {rows.map(({ label, value }) => (
        <p key={label}>
          {label}: {value}
        </p>
      ))}
    </div>
  );
};

const RejectedRows: React.FC<{ rows: NonNullable<UploadResponse['rejectedRows']> }> = ({
  rows,
}) => (
  <div className="mt-3 p-3 bg-semantic-surface-1 rounded border border-semantic-critical-muted">
    <p className="text-sm font-medium mb-2">Rejected rows</p>
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={`${row.rowNumber}-${row.reason}`} className="text-sm">
          <p className="font-medium">
            Row {row.rowNumber}: {row.reason}
          </p>
          <p className="text-sm">
            SKU: {row.rawValues.sku || '-'} | Item Description:{' '}
            {row.rawValues.itemDescription || '-'} | Used-By Date: {row.rawValues.usedByDate || '-'}
          </p>
        </div>
      ))}
    </div>
  </div>
);

const ColumnSummary: React.FC<{ columnsUsed: string[]; columnsIgnored?: number }> = ({
  columnsUsed,
  columnsIgnored,
}) => (
  <div className="mt-3 p-3 bg-semantic-surface-1 rounded border border-semantic-success-muted">
    <p className="text-sm font-medium">Column summary</p>
    <p className="text-sm">
      Used: <span className="font-mono">{columnsUsed.join(', ')}</span>
    </p>
    {columnsIgnored !== undefined && columnsIgnored > 0 && (
      <p className="text-sm text-semantic-success-muted-foreground">
        Ignored {formatCount(columnsIgnored)} extra column
        {columnsIgnored > 1 ? 's' : ''}
      </p>
    )}
  </div>
);

const guidelineLinkLabel = (error: string): string | null => {
  if (error.includes('column') && error.toLowerCase().includes('name')) {
    return 'See format guidelines';
  }
  if (error.includes('cost') && error.toLowerCase().includes('format')) {
    return 'See cost format guidelines';
  }
  return null;
};

const ErrorDetails: React.FC<{
  errors: string[];
  formatGuidelinesId: string;
  onShowGuidelines: () => void;
}> = ({ errors, formatGuidelinesId, onShowGuidelines }) => (
  <div className="mt-2">
    <h3 className="font-semibold mt-3">Error details:</h3>
    <ul className="list-disc pl-5 mt-1 space-y-1">
      {withOccurrenceKeys(errors, (e) => e).map(({ item: error, key }) => {
        const linkLabel = guidelineLinkLabel(error);
        return (
          <li key={key} className="text-sm">
            {linkLabel ? (
              <span>
                {error} -{' '}
                <button
                  type="button"
                  className="min-h-11 cursor-pointer font-medium underline underline-offset-2"
                  onClick={onShowGuidelines}
                  aria-controls={formatGuidelinesId}
                >
                  {linkLabel}
                </button>
              </span>
            ) : (
              <span>{error}</span>
            )}
          </li>
        );
      })}
    </ul>
  </div>
);

export const UploadResultPanel: React.FC<UploadResultPanelProps> = ({
  uploadResult,
  isExpiryImport,
  returnUrl,
  formatGuidelinesId,
  onShowGuidelines,
  onDownloadErrorReport,
  onContinue,
}) => (
  <div
    role={uploadResult.success ? 'status' : 'alert'}
    className={`mt-6 p-4 rounded-md ${uploadResult.success ? 'bg-semantic-success-muted text-semantic-success-muted-foreground' : 'bg-semantic-critical-muted text-semantic-critical-muted-foreground'}`}
  >
    <h2 className="font-semibold mb-2">
      {uploadResult.success ? 'Upload successful' : 'Upload failed'}
    </h2>

    <p>{uploadResult.message}</p>

    <ResultCounts uploadResult={uploadResult} isExpiryImport={isExpiryImport} />

    {uploadResult.errorReportUrl && (
      <ErrorReportButton
        reportUrl={uploadResult.errorReportUrl}
        onDownload={onDownloadErrorReport}
      />
    )}

    {isExpiryImport && uploadResult.rejectedRows && uploadResult.rejectedRows.length > 0 && (
      <RejectedRows rows={uploadResult.rejectedRows} />
    )}

    {uploadResult.columnsUsed && uploadResult.columnsUsed.length > 0 && (
      <ColumnSummary
        columnsUsed={uploadResult.columnsUsed}
        columnsIgnored={uploadResult.columnsIgnored}
      />
    )}

    {uploadResult.errors && uploadResult.errors.length > 0 && (
      <ErrorDetails
        errors={uploadResult.errors}
        formatGuidelinesId={formatGuidelinesId}
        onShowGuidelines={onShowGuidelines}
      />
    )}

    {uploadResult.success && isSafeReturnUrl(returnUrl) && (
      <div className="mt-6 pt-4 border-t border-semantic-success-muted">
        <Button
          type="button"
          onClick={() => onContinue(returnUrl)}
          className="min-h-11 w-full py-2 font-semibold"
        >
          Continue to next step
        </Button>
      </div>
    )}
  </div>
);
