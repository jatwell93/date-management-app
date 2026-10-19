// Presentational pieces of the Expired items page (`/expired-items`). Used only by
// pages/ExpiredItemsPage.tsx; split out so the page component stays small.
import React, { lazy, Suspense } from 'react';
import type { ChartData, ChartOptions } from 'chart.js';
import { ExpiredItem } from '../../types/inventory';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

const Bar = lazy(() => import('../charts/lazyCharts').then((m) => ({ default: m.Bar })));

export type ExpiredItemAction = 'sold_through' | 'expired';

export const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});

const axisCurrencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

// Shared by both loss charts. Ticks are whole dollars (precision: 0) so small
// totals cannot produce fractional ticks that the formatter rounds into
// duplicate labels ($0, $1, $1, ...).
export const lossChartOptions: ChartOptions<'bar'> = {
  responsive: true,
  plugins: {
    // The card heading already names each chart; a canvas title would repeat it.
    title: { display: false },
    legend: { display: false },
  },
  scales: {
    y: {
      beginAtZero: true,
      ticks: {
        precision: 0,
        callback: (value) => {
          const num = typeof value === 'number' ? value : Number(value);
          return Number.isFinite(num) ? axisCurrencyFormatter.format(num) : `${value}`;
        },
      },
    },
  },
};

const dateFormatter = new Intl.DateTimeFormat('en-AU', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function formatExpiry(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : dateFormatter.format(d);
}

// The number entered here is the physically-counted expired quantity, recorded
// at write-off time. It is intentionally NOT capped by `quantityAvailable`: the
// scan flow only logs a SKU + expiry marker (not real stock-on-hand), so the true
// expired count is only known now. See issue #268. We still require a whole number
// >= 1; the write-off ledger is the source of truth for the recorded loss.
export function parseUnitsDiscardedInput(rawUnitsDiscarded: string): {
  value?: number;
  error: string | null;
} {
  const trimmed = rawUnitsDiscarded.trim();
  if (trimmed === '') {
    return { error: 'Must be at least 1' };
  }

  if (!/^\d+$/.test(trimmed)) {
    return { error: 'Enter a whole number' };
  }

  const parsed = Number(trimmed);
  if (parsed < 1) {
    return { error: 'Must be at least 1' };
  }

  return { value: parsed, error: null };
}

const SKELETON_ROWS = Array.from({ length: 5 }, (_, i) => i);
const PULSE = 'rounded bg-semantic-surface-3 motion-safe:animate-pulse';
const OUTLINE_PRIMARY_BUTTON =
  'min-h-11 rounded-md border border-semantic-primary text-sm font-medium text-semantic-primary hover:bg-semantic-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-semantic-primary transition-colors';
const EXPIRED_BUTTON =
  'min-h-11 text-semantic-critical border-semantic-critical hover:bg-semantic-critical/10 hover:text-semantic-critical-active';
const HEAD_LEFT =
  'text-left text-sm font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider';
const HEAD_RIGHT =
  'text-right text-sm font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider';
const CELL = 'whitespace-nowrap text-sm text-semantic-text-primary';
const CELL_NUMERIC = 'whitespace-nowrap text-right text-sm tabular-nums text-semantic-text-primary';
const PROCESS_DIALOG_LABEL_CLASS = 'text-sm font-medium text-semantic-text-secondary';
const PROCESS_DIALOG_VALUE_CLASS =
  'text-sm font-medium tabular-nums text-semantic-text-primary break-words';
const PROCESS_DIALOG_HELP_CLASS = 'mt-1 text-sm font-medium text-semantic-text-secondary';
const PROCESS_DIALOG_ERROR_CLASS = 'mt-1 text-sm font-medium text-semantic-critical';
const CRITICAL_BANNER =
  'rounded-md border border-semantic-critical/20 bg-semantic-critical-muted p-3 text-semantic-critical-muted-foreground';

export const PageLoadingSkeleton: React.FC = () => (
  <div className="py-8" role="status" aria-live="polite" aria-label="Loading expired items">
    <div className="mb-6">
      <div className="h-8 w-48 rounded-md bg-semantic-surface-3 motion-safe:animate-pulse" />
      <div className={`mt-2 h-4 w-80 ${PULSE}`} />
    </div>
    <div className="rounded-md border overflow-hidden">
      {SKELETON_ROWS.map((i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b last:border-0">
          <div className={`h-4 w-20 ${PULSE}`} />
          <div className={`h-4 w-40 ${PULSE}`} />
          <div className={`h-4 w-28 ${PULSE}`} />
          <div className={`h-4 w-24 ${PULSE} ml-auto`} />
        </div>
      ))}
    </div>
  </div>
);

export const PageLoadError: React.FC<{ error: string; onRetry: () => void }> = ({
  error,
  onRetry,
}) => (
  <div className="py-8">
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <p className="text-semantic-critical font-medium" role="alert">
        {error}
      </p>
      <button type="button" onClick={onRetry} className={`${OUTLINE_PRIMARY_BUTTON} px-4 py-2`}>
        Try again
      </button>
    </div>
  </div>
);

export const PageHeader: React.FC = () => (
  <header className="mb-6">
    <div className="flex items-center justify-between">
      <h1 id="expired-items-heading" className="text-3xl font-semibold font-heading">
        Expired Items
      </h1>
      <button
        type="button"
        onClick={() => window.print()}
        className={`hidden md:flex items-center gap-2 px-3 py-1.5 no-print ${OUTLINE_PRIMARY_BUTTON}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9V2h12v7" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
        Print Report
      </button>
    </div>
    <p className="mt-2 text-sm text-semantic-text-secondary max-w-2xl">
      Review and process stock that has reached its expiry date. Processed items are moved to loss
      reports.
    </p>
  </header>
);

export const ExpiredItemsEmptyState: React.FC = () => (
  <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
    <p className="text-semantic-text-secondary text-sm">No expired items found.</p>
    <p className="text-semantic-text-tertiary text-sm max-w-xs">
      Items that have reached their expiry date will appear here for processing.
    </p>
  </div>
);

interface ItemListProps {
  items: ExpiredItem[];
  isProcessing: boolean;
  onAction: (item: ExpiredItem, action: ExpiredItemAction) => void;
}

const RowActions: React.FC<{
  item: ExpiredItem;
  isProcessing: boolean;
  onAction: ItemListProps['onAction'];
  grow?: boolean;
}> = ({ item, isProcessing, onAction, grow = false }) => {
  const growClass = grow ? ' flex-1' : '';
  return (
    <>
      <Button
        onClick={() => onAction(item, 'sold_through')}
        aria-label={`Mark ${item.productName} as sold through`}
        variant="outline"
        size="sm"
        className={`min-h-11${growClass}`}
        disabled={isProcessing}
      >
        Sold Through
      </Button>
      <Button
        onClick={() => onAction(item, 'expired')}
        aria-label={`Mark ${item.productName} as expired`}
        variant="outline"
        size="sm"
        className={`${EXPIRED_BUTTON}${growClass}`}
        disabled={isProcessing}
      >
        Expired
      </Button>
    </>
  );
};

export const ExpiredItemsPhoneList: React.FC<ItemListProps> = ({
  items,
  isProcessing,
  onAction,
}) => (
  <ul className="mb-5 space-y-3 lg:hidden" aria-label="Expired items">
    {items.map((item) => (
      <li key={item.id} className="rounded-lg border bg-semantic-surface-1 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words font-medium">{item.productName}</p>
            <p className="mt-1 text-sm text-semantic-text-secondary">
              <span className="font-mono">{item.sku}</span> · {item.locationName}
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-semantic-critical-muted px-2 py-1 text-sm font-medium text-semantic-critical-muted-foreground">
            {item.status}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-semantic-text-secondary">Expiry</dt>
            <dd className="font-medium tabular-nums">{formatExpiry(item.expiryDate)}</dd>
          </div>
          <div>
            <dt className="text-semantic-text-secondary">Available</dt>
            <dd className="font-medium tabular-nums">{item.quantityAvailable}</dd>
          </div>
        </dl>
        <div className="mt-4 flex gap-2">
          <RowActions item={item} isProcessing={isProcessing} onAction={onAction} grow />
        </div>
      </li>
    ))}
  </ul>
);

const ItemTableHeader: React.FC<{ withActions: boolean }> = ({ withActions }) => (
  <TableHeader>
    <TableRow className="bg-semantic-surface-2 hover:bg-semantic-surface-2">
      <TableHead className={HEAD_LEFT}>SKU</TableHead>
      <TableHead className={HEAD_LEFT}>Product Name</TableHead>
      <TableHead className={HEAD_LEFT}>Location</TableHead>
      <TableHead className={HEAD_LEFT}>Expiry Date</TableHead>
      <TableHead className={HEAD_RIGHT}>Cost Price</TableHead>
      <TableHead className={HEAD_RIGHT}>Qty</TableHead>
      <TableHead className={HEAD_LEFT}>Status</TableHead>
      {withActions && <TableHead className={HEAD_LEFT}>Actions</TableHead>}
    </TableRow>
  </TableHeader>
);

const ItemDataCells: React.FC<{ item: ExpiredItem }> = ({ item }) => (
  <>
    <TableCell className={CELL}>{item.sku}</TableCell>
    <TableCell className={`${CELL} font-medium`}>{item.productName}</TableCell>
    <TableCell className="whitespace-nowrap text-sm text-semantic-text-secondary">
      {item.locationName}
    </TableCell>
    <TableCell className={`${CELL} tabular-nums`}>{formatExpiry(item.expiryDate)}</TableCell>
    <TableCell className={CELL_NUMERIC}>{currencyFormatter.format(item.costPrice)}</TableCell>
    <TableCell className={CELL_NUMERIC}>{item.quantityAvailable}</TableCell>
    <TableCell className="whitespace-nowrap text-sm font-medium text-semantic-critical">
      {item.status}
    </TableCell>
  </>
);

export const ExpiredItemsTables: React.FC<ItemListProps> = ({ items, isProcessing, onAction }) => (
  <div className="hidden lg:block overflow-x-auto rounded-md border print-report-target">
    <div className="no-print">
      <Table aria-label="Expired items">
        <ItemTableHeader withActions />
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} className="hover:bg-semantic-surface-2/50 transition-colors">
              <ItemDataCells item={item} />
              <TableCell className="whitespace-nowrap text-sm">
                <div className="flex gap-2">
                  <RowActions item={item} isProcessing={isProcessing} onAction={onAction} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
    <div className="print-only">
      <Table aria-label="Printable expired items table">
        <ItemTableHeader withActions={false} />
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <ItemDataCells item={item} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  </div>
);

export const ChartsErrorBanner: React.FC<{ error: string | null }> = ({ error }) =>
  error ? (
    <div className={`mt-6 text-sm ${CRITICAL_BANNER}`} role="alert">
      {error}
    </div>
  ) : null;

interface LossChartCardProps {
  title: string;
  loading: boolean;
  loadingLabel: string;
  emptyText: string;
  chartLabel: string;
  data: ChartData<'bar'>;
  options: ChartOptions<'bar'>;
}

const LossChartBody: React.FC<LossChartCardProps> = ({
  loading,
  loadingLabel,
  emptyText,
  chartLabel,
  data,
  options,
}) => {
  if (loading) {
    return (
      <div className="space-y-2 py-2" role="status" aria-label={loadingLabel}>
        <div className={`h-4 w-3/4 ${PULSE}`} />
        <div className={`h-32 w-full ${PULSE}`} />
        <div className={`h-4 w-1/2 ${PULSE}`} />
      </div>
    );
  }
  if (!data.labels || data.labels.length === 0) {
    return <div className="py-8 text-center text-sm text-semantic-text-tertiary">{emptyText}</div>;
  }
  return (
    <Suspense fallback={<div className={`h-48 w-full ${PULSE}`} />}>
      <Bar data={data} options={options} role="img" aria-label={chartLabel} />
    </Suspense>
  );
};

export const LossChartCard: React.FC<LossChartCardProps> = (props) => (
  <Card>
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>
        {props.title}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="min-h-[12rem]">
        <LossChartBody {...props} />
      </div>
    </CardContent>
  </Card>
);

interface ProcessItemDialogProps {
  open: boolean;
  item: ExpiredItem | null;
  action: ExpiredItemAction | null;
  unitsDiscarded: string;
  unitsDiscardedError: string | null;
  processError: string | null;
  isProcessing: boolean;
  isConfirmOpen: boolean;
  onUnitsChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
  onSubmit: () => void;
  onConfirm: () => void;
  onConfirmOpenChange: (open: boolean) => void;
  onConfirmCancel: () => void;
}

const ItemDetails: React.FC<{ item: ExpiredItem }> = ({ item }) => (
  <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
    <div className="col-span-2">
      <dt className={PROCESS_DIALOG_LABEL_CLASS}>Product</dt>
      <dd className={PROCESS_DIALOG_VALUE_CLASS}>{item.productName}</dd>
    </div>
    <div>
      <dt className={PROCESS_DIALOG_LABEL_CLASS}>SKU</dt>
      <dd className={PROCESS_DIALOG_VALUE_CLASS}>{item.sku}</dd>
    </div>
    <div>
      <dt className={PROCESS_DIALOG_LABEL_CLASS}>Location</dt>
      <dd className={PROCESS_DIALOG_VALUE_CLASS}>{item.locationName}</dd>
    </div>
    <div>
      <dt className={PROCESS_DIALOG_LABEL_CLASS}>Expiry Date</dt>
      <dd className={PROCESS_DIALOG_VALUE_CLASS}>{formatExpiry(item.expiryDate)}</dd>
    </div>
    <div>
      <dt className={PROCESS_DIALOG_LABEL_CLASS}>Cost Price</dt>
      <dd className={PROCESS_DIALOG_VALUE_CLASS}>{currencyFormatter.format(item.costPrice)}</dd>
    </div>
  </dl>
);

const UnitsDiscardedField: React.FC<{
  value: string;
  error: string | null;
  onChange: ProcessItemDialogProps['onUnitsChange'];
}> = ({ value, error, onChange }) => (
  <div className="mb-4">
    <Label htmlFor="units-discarded" className="mb-1 block">
      Units to Discard
    </Label>
    <Input
      id="units-discarded"
      type="number"
      min="1"
      step="1"
      value={value}
      onChange={onChange}
      aria-describedby={error ? 'units-hint units-error' : 'units-hint'}
      aria-invalid={!!error}
    />
    <p id="units-hint" className={PROCESS_DIALOG_HELP_CLASS}>
      Enter the total number of expired units to write off.
    </p>
    {error && (
      <p id="units-error" className={PROCESS_DIALOG_ERROR_CLASS} role="alert">
        {error}
      </p>
    )}
  </div>
);

function confirmDescription(
  action: ExpiredItemAction,
  unitsDiscarded: string,
  costPrice: number,
): string {
  if (action !== 'expired') {
    return 'Confirm marking this item as sold through. This action cannot be undone.';
  }
  const loss = (parseUnitsDiscardedInput(unitsDiscarded).value ?? 0) * costPrice;
  return `Confirm writing off ${unitsDiscarded} units for ${currencyFormatter.format(
    loss,
  )} loss. This action cannot be undone.`;
}

const ProcessItemDialogBody: React.FC<
  ProcessItemDialogProps & { item: ExpiredItem; action: ExpiredItemAction }
> = ({
  item,
  action,
  unitsDiscarded,
  unitsDiscardedError,
  processError,
  isProcessing,
  isConfirmOpen,
  onUnitsChange,
  onClose,
  onSubmit,
  onConfirm,
  onConfirmOpenChange,
  onConfirmCancel,
}) => {
  const isExpired = action === 'expired';
  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Process Expired Item</DialogTitle>
        <DialogDescription>
          Review item details and choose the quantity to process.
        </DialogDescription>
      </DialogHeader>
      <ItemDetails item={item} />

      {isExpired && (
        <UnitsDiscardedField
          value={unitsDiscarded}
          error={unitsDiscardedError}
          onChange={onUnitsChange}
        />
      )}

      {processError && (
        <div className={`mb-4 ${CRITICAL_BANNER}`} role="alert">
          {processError}
        </div>
      )}

      <DialogFooter className="mt-6">
        <Button variant="outline" className="min-h-11" onClick={onClose} disabled={isProcessing}>
          Cancel
        </Button>
        <Button
          onClick={onSubmit}
          disabled={isProcessing || !!unitsDiscardedError}
          className={
            isExpired
              ? 'min-h-11 bg-semantic-critical hover:bg-semantic-critical-hover'
              : 'min-h-11'
          }
        >
          {isExpired ? 'Mark Expired' : 'Mark Sold Through'}
        </Button>
      </DialogFooter>

      <AlertDialog open={isConfirmOpen} onOpenChange={onConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Action</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDescription(action, unitsDiscarded, item.costPrice)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" onClick={onConfirmCancel}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={onConfirm} disabled={isProcessing}>
              {isProcessing ? 'Processing…' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogContent>
  );
};

export const ProcessItemDialog: React.FC<ProcessItemDialogProps> = (props) => {
  const { open, item, action, onClose } = props;
  return (
    <Dialog open={open && !!item && !!action} onOpenChange={(next) => !next && onClose()}>
      {item && action && <ProcessItemDialogBody {...props} item={item} action={action} />}
    </Dialog>
  );
};
