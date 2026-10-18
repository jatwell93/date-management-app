import React from 'react';
import type { MarkdownCreditContext } from '@shared/markdown-credit-context';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../components/ui/alert-dialog';
import { MarkdownCreditScopeBadge } from '../../components/MarkdownCreditScopeBadge';
import { MarkdownMatricesNotice } from '../../components/MarkdownMatricesNotice';

/** Sections of the Scan page (`/scan`). Used only by `pages/ScanPage.tsx`. */

export interface StoreArea {
  id: number;
  name: string;
  subDepartment?: string;
}

export interface ProductDetails extends MarkdownCreditContext {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  costPrice?: number | null;
  retailPrice?: number | null;
}

export interface RecentInventoryItem {
  id: number;
  productId: number;
  expiryDate: string;
  locationId: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const expiryDateFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Sydney',
});

const addedAtFormatter = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Sydney',
  dateStyle: 'medium',
  timeStyle: 'short',
});

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});

export function formatExpiryDateForCopy(expiryDate: string): string {
  return expiryDateFormatter.format(new Date(expiryDate));
}

function formatCostPrice(costPrice: number | null | undefined): string {
  return typeof costPrice === 'number' && Number.isFinite(costPrice)
    ? currencyFormatter.format(costPrice)
    : 'Not available';
}

const SECTION_CLASS = 'mt-6 border-t border-border pt-6';
const FIELD_LABEL_CLASS = 'text-foreground';
const FIELD_INPUT_CLASS = 'mt-1 h-11 border-input bg-background text-foreground';
const MESSAGE_CLASS = 'border px-4 py-3 rounded relative text-center mt-4';

interface ScanMessagesProps {
  error: string | null;
  successMessage: string | null;
  errorRef: React.Ref<HTMLDivElement>;
}

export function ScanMessages({ error, successMessage, errorRef }: ScanMessagesProps) {
  return (
    <>
      {error && (
        <div
          ref={errorRef}
          className={`bg-semantic-critical-muted border-semantic-critical text-semantic-critical-muted-foreground ${MESSAGE_CLASS}`}
          role="alert"
        >
          <span className="block sm:inline">Error: {error}</span>
        </div>
      )}
      {successMessage && (
        <div
          className={`bg-semantic-success-muted border-semantic-success text-semantic-success-muted-foreground ${MESSAGE_CLASS}`}
          role="status"
          aria-live="polite"
        >
          <span className="block sm:inline">{successMessage}</span>
        </div>
      )}
    </>
  );
}

interface TextFieldProps extends Omit<React.ComponentProps<typeof Input>, 'onChange'> {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}

function TextField({ id, label, value, onValueChange, className, ...inputProps }: TextFieldProps) {
  return (
    <div>
      <Label htmlFor={id} className={FIELD_LABEL_CLASS}>
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        className={className ? `${FIELD_INPUT_CLASS} ${className}` : FIELD_INPUT_CLASS}
        {...inputProps}
      />
    </div>
  );
}

interface NewProductFormProps {
  barcode: string;
  name: string;
  sku: string;
  costPrice: string;
  onNameChange: (value: string) => void;
  onSkuChange: (value: string) => void;
  onCostPriceChange: (value: string) => void;
  onSubmit: () => void;
}

export function NewProductForm({
  barcode,
  name,
  sku,
  costPrice,
  onNameChange,
  onSkuChange,
  onCostPriceChange,
  onSubmit,
}: NewProductFormProps) {
  return (
    <div className={SECTION_CLASS}>
      <h2 className="font-semibold text-lg text-foreground tabular-nums">
        No catalog match for barcode {barcode}
      </h2>
      <p className="text-sm mb-4 text-muted-foreground">
        Create a product record before adding expiry stock.
      </p>
      <div className="space-y-4">
        <TextField
          id="newProductName"
          label="Product name"
          type="text"
          value={name}
          onValueChange={onNameChange}
          placeholder="Enter product name"
        />
        <TextField
          id="newProductSKU"
          label="SKU"
          type="text"
          value={sku}
          onValueChange={onSkuChange}
          placeholder="Enter SKU"
        />
        <TextField
          id="newProductCostPrice"
          label="Cost price"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={costPrice}
          onValueChange={onCostPriceChange}
          placeholder="Enter cost price"
        />
        <Button onClick={onSubmit} className="w-full min-h-11">
          Create product
        </Button>
      </div>
    </div>
  );
}

interface ProductSummaryProps {
  product: ProductDetails;
  markdownConfig: React.ComponentProps<typeof MarkdownMatricesNotice>;
  markdownPrice: number | null;
  markdownPercentage: number | null;
  isExpiredStock: boolean;
}

function ProductSummary({
  product,
  markdownConfig,
  markdownPrice,
  markdownPercentage,
  isExpiredStock,
}: ProductSummaryProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <h2 className="font-semibold text-lg text-foreground mb-1">Product details</h2>
        <p className="text-foreground">
          <span className="font-medium">Name:</span> {product.name}
        </p>
        <p className="text-foreground tabular-nums">
          <span className="font-medium">SKU:</span> {product.sku}
        </p>
        <p className="text-foreground tabular-nums">
          <span className="font-medium">Barcode:</span> {product.barcode}
        </p>
      </div>
      <div>
        <p className="text-foreground tabular-nums">
          <span className="font-medium">Cost price:</span> {formatCostPrice(product.costPrice)}
        </p>
        <div className="mt-2">
          <MarkdownCreditScopeBadge
            creditScope={product.creditScope ?? 'NO_CREDIT'}
            creditScopeReason={product.creditScopeReason ?? 'NO_CREDIT'}
            creditSupplierId={product.creditSupplierId ?? null}
            creditSupplierName={product.creditSupplierName ?? null}
          />
        </div>

        <MarkdownMatricesNotice {...markdownConfig} />
        {markdownPrice !== null && markdownPercentage !== null && (
          <p className="text-semantic-warning-muted-foreground font-semibold mt-1 tabular-nums">
            Markdown price ({markdownPercentage}% off): {currencyFormatter.format(markdownPrice)}
          </p>
        )}
        {isExpiredStock && (
          <div className="mt-2">
            <Badge variant="error">Expired</Badge>
          </div>
        )}
      </div>
    </div>
  );
}

interface ExpiryEntryFormProps {
  expiryDate: string;
  onExpiryDateChange: (value: string) => void;
  locationId: string;
  onLocationChange: (value: string) => void;
  storeAreas: StoreArea[];
  onSubmit: () => void;
}

function ExpiryEntryForm({
  expiryDate,
  onExpiryDateChange,
  locationId,
  onLocationChange,
  storeAreas,
  onSubmit,
}: ExpiryEntryFormProps) {
  return (
    <div className="mt-6 space-y-6">
      <TextField
        id="expiryDate"
        label="Expiry date"
        type="date"
        value={expiryDate}
        onValueChange={onExpiryDateChange}
        className="w-full"
      />
      <div>
        <Label htmlFor="location" className={FIELD_LABEL_CLASS}>
          Location
        </Label>
        <Select onValueChange={onLocationChange} value={locationId}>
          <SelectTrigger
            id="location"
            className="w-full mt-1 data-[size=default]:h-11 text-base border-input bg-background text-foreground"
          >
            <SelectValue placeholder="Select a location" />
          </SelectTrigger>
          <SelectContent className="border-input bg-background text-foreground">
            {storeAreas.map((area) => (
              <SelectItem key={area.id} value={area.id.toString()}>
                {area.name}
                {area.subDepartment ? ` (${area.subDepartment})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={onSubmit} className="w-full min-h-11">
        Save expiry item
      </Button>
    </div>
  );
}

export type ProductPanelProps = ProductSummaryProps & ExpiryEntryFormProps;

export function ProductPanel(props: ProductPanelProps) {
  return (
    <div className={SECTION_CLASS}>
      <ProductSummary {...props} />
      <ExpiryEntryForm {...props} />
    </div>
  );
}

interface RecentEntriesListProps {
  productName: string;
  entries: RecentInventoryItem[];
  pendingDeleteId: number | null;
  isDeleteDialogOpen: boolean;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onRequestDelete: (entryId: number) => void;
  onConfirmDelete: () => void;
}

function deleteDescription(entry: RecentInventoryItem | null, productName: string): string {
  if (!entry) {
    return 'This removes the selected expiry entry. This cannot be undone.';
  }
  return `This removes the ${formatExpiryDateForCopy(
    entry.expiryDate,
  )} expiry entry for ${productName}. This cannot be undone.`;
}

export function RecentEntriesList({
  productName,
  entries,
  pendingDeleteId,
  isDeleteDialogOpen,
  onDeleteDialogOpenChange,
  onRequestDelete,
  onConfirmDelete,
}: RecentEntriesListProps) {
  const entryPendingDelete = entries.find((entry) => entry.id === pendingDeleteId) ?? null;
  return (
    <div className="mt-8 border-t border-border pt-6">
      <h2 className="font-semibold text-lg text-foreground mb-4">Recent entries</h2>
      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-3 p-3 border border-border rounded-md"
          >
            <div>
              <p className="text-foreground tabular-nums">
                <span className="font-medium">Expiry date:</span>{' '}
                {formatExpiryDateForCopy(entry.expiryDate)}
              </p>
              <p className="text-muted-foreground text-sm tabular-nums">
                Added: {addedAtFormatter.format(new Date(entry.createdAt))}
              </p>
            </div>
            <AlertDialog
              open={isDeleteDialogOpen && pendingDeleteId === entry.id}
              onOpenChange={onDeleteDialogOpenChange}
            >
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  className="min-h-11"
                  onClick={() => onRequestDelete(entry.id)}
                  aria-label={`Delete entry expiring ${formatExpiryDateForCopy(entry.expiryDate)}`}
                >
                  Delete entry
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete expiry entry?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {deleteDescription(entryPendingDelete, productName)}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onConfirmDelete}>Delete entry</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}
      </div>
    </div>
  );
}
