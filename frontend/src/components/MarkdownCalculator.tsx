import React, { useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Scanner } from './Scanner';
import { apiService } from '../lib/api.service';
import { calculateMarkdownPrice, getMarkdownLevelForDays } from '@shared/markdown';
import { HardwareScanResult } from '../types/handheld';
import { useFreshApiToken } from '../hooks/useFreshApiToken';
import { useMarkdownMatrices } from '../hooks/useMarkdownMatrix';
import { calendarDaysUntil } from '../lib/utils';
import { raceAbort, useLatestScanLookup } from '../hooks/useLatestScanLookup';
import type { MarkdownCreditContext } from '@shared/markdown-credit-context';
import { MarkdownCreditScopeBadge } from './MarkdownCreditScopeBadge';
import { MarkdownMatricesNotice } from './MarkdownMatricesNotice';

interface MarkdownCalculatorProps {
  token: string | null;
}

interface ProductDetails extends MarkdownCreditContext {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  costPrice?: number | null;
  retailPrice?: number | null;
}

interface MarkdownResult {
  status: string;
  value: number;
}

interface ValidationError {
  field: 'costPrice' | 'expiryDate';
  message: string;
}

const VALIDATION_ERROR_ID = 'markdown-validation-error';
const COST_PRICE_HINT_ID = 'costPrice-hint';

function isUsableCost(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

const NO_MATCH_MESSAGE =
  'No product matched that barcode or SKU. Enter the cost price and expiry date manually.';

/** Looks a scanned code up by SKU or barcode (short codes try SKU first). */
async function findProduct(
  input: string,
  apiToken: string | undefined,
  signal: AbortSignal,
): Promise<ProductDetails | null> {
  const bySku = `/products/by-sku/${input}`;
  const byBarcode = `/products/by-barcode/${input}`;
  const [first, second] = input.length <= 8 ? [bySku, byBarcode] : [byBarcode, bySku];
  const product = await apiService.get<ProductDetails | null>(first, apiToken, signal);
  return product ?? apiService.get<ProductDetails | null>(second, apiToken, signal);
}

function lookupErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  return message.includes('404')
    ? NO_MATCH_MESSAGE
    : 'We could not look up that product. Enter the cost price and expiry date manually.';
}

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});

export function MarkdownCalculator({ token }: MarkdownCalculatorProps) {
  const getFreshApiToken = useFreshApiToken(token);
  const [costPrice, setCostPrice] = useState<string>('');
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [markdownResult, setMarkdownResult] = useState<MarkdownResult | null>(null);
  const [scannedInput, setScannedInput] = useState<string | null>(null);
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<ValidationError | null>(null);
  const costPriceRef = useRef<HTMLInputElement>(null);
  const expiryDateRef = useRef<HTMLInputElement>(null);
  // Only the latest scan may update the view; see useLatestScanLookup.
  const { start: startScan, inFlightRef: scanInFlightRef } = useLatestScanLookup();
  // Load the org's markdown matrix so the calculator honors configured bands and
  // basis (issue #338). Falls back to the default ladder if it cannot be loaded.
  const markdownConfig = useMarkdownMatrices(token);

  // Only a positive catalog cost is a usable preset; 0 would lock the field on a value
  // that validation rejects, so it stays editable.
  const hasProductCost = isUsableCost(productDetails?.costPrice);

  const formattedProductCost = useMemo(
    () =>
      productDetails &&
      typeof productDetails.costPrice === 'number' &&
      Number.isFinite(productDetails.costPrice)
        ? currencyFormatter.format(productDetails.costPrice)
        : 'Not available',
    [productDetails],
  );

  const handleBarcodeScan = async (result: HardwareScanResult) => {
    const input = result.barcode;
    // A keyboard-wedge scanner ends its burst with Enter. When a form input has focus
    // that Enter also submits the form, right after this handler runs; the scan stays
    // in flight so calculateMarkdown ignores that submit. A newer scan supersedes it.
    const scan = startScan();
    setScannedInput(input);
    setProductDetails(null);
    setMarkdownResult(null);
    setError(null);
    setValidationError(null);

    if (!token) {
      scan.finish();
      setError('Sign in again before scanning a product, then retry the barcode or SKU.');
      return;
    }

    try {
      const lookup = async () => {
        const apiToken = await getFreshApiToken('markdown-product-lookup');
        return findProduct(input, apiToken, scan.signal);
      };
      const product = await raceAbort(lookup(), scan.signal);
      if (!scan.isCurrent()) return;
      if (!product) {
        setError(NO_MATCH_MESSAGE);
        return;
      }
      setProductDetails(product);
      setCostPrice(isUsableCost(product.costPrice) ? String(product.costPrice) : '');
    } catch (err: unknown) {
      if (scan.isCurrent()) setError(lookupErrorMessage(err));
    } finally {
      scan.finish();
    }
  };

  const calculateMarkdown = (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (scanInFlightRef.current) {
      // Scanner's trailing Enter, or a submit while the scanned product is loading.
      return;
    }
    if (markdownConfig.status !== 'ready' || !markdownConfig.matrices) {
      setMarkdownResult(null);
      return;
    }
    const parsedCostPrice = Number(costPrice);

    setValidationError(null);

    if (!Number.isFinite(parsedCostPrice) || parsedCostPrice <= 0) {
      setValidationError({
        field: 'costPrice',
        message: 'Enter a cost price greater than 0 before calculating a markdown.',
      });
      setMarkdownResult(null);
      costPriceRef.current?.focus();
      return;
    }

    if (!expiryDate) {
      setValidationError({
        field: 'expiryDate',
        message: 'Choose an expiry date before calculating a markdown.',
      });
      setMarkdownResult(null);
      expiryDateRef.current?.focus();
      return;
    }

    // Whole local calendar days, so the band does not shift with the time of day.
    const diffDays = calendarDaysUntil(expiryDate);

    // Status derives from the shared day-to-band mapping (no local ladder to drift).
    const level = getMarkdownLevelForDays(diffDays);
    let status = 'Normal';
    if (diffDays <= 0) {
      status = 'Expired';
    } else if (level !== null) {
      status = `Markdown ${level}`;
    }

    const retailPrice =
      typeof productDetails?.retailPrice === 'number' && Number.isFinite(productDetails.retailPrice)
        ? productDetails.retailPrice
        : null;

    // Expired stock is pulled, not marked down; everything else uses the org matrix,
    // which selects cost or retail per band and falls back to cost without retail.
    const markdownMatrix = markdownConfig.matrices[productDetails?.creditScope ?? 'NO_CREDIT'];
    const resolved = calculateMarkdownPrice(
      { costPrice: parsedCostPrice, retailPrice },
      diffDays,
      markdownMatrix,
    );
    const value = resolved ?? parsedCostPrice;

    setMarkdownResult({ status, value });
  };

  return (
    <Card className="mx-auto w-full max-w-4xl">
      <CardHeader>
        {/* CardTitle renders a div; expose it as the page heading. */}
        <CardTitle role="heading" aria-level={1}>
          Expiry markdown calculator
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
          <div className="min-w-0 space-y-4">
            <section aria-labelledby="scan-product-heading" className="min-w-0 space-y-3">
              <div>
                <h2 id="scan-product-heading" className="font-heading text-lg font-semibold">
                  Scan product
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Scan a barcode or SKU to pull the cost price from the product catalog.
                </p>
              </div>
              <Scanner onScan={handleBarcodeScan} isHandheld />
            </section>

            {/* Kept mounted so screen readers announce each new scan reliably. */}
            <p
              role="status"
              aria-label="Last scanned code"
              className={
                scannedInput ? 'min-w-0 break-words text-sm text-muted-foreground' : 'sr-only'
              }
            >
              {scannedInput ? `Last scanned: ${scannedInput}` : null}
            </p>

            {error && (
              <p
                role="alert"
                className="min-w-0 break-words text-sm text-semantic-critical-muted-foreground"
              >
                {error}
              </p>
            )}

            {productDetails && (
              <section
                aria-labelledby="scanned-product-heading"
                className="min-w-0 rounded-md border bg-semantic-surface-2 p-4"
              >
                <h2 id="scanned-product-heading" className="font-heading text-base font-semibold">
                  Scanned product
                </h2>
                <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                  <dt className="font-medium text-muted-foreground">Name</dt>
                  <dd className="min-w-0 break-words">{productDetails.name}</dd>
                  <dt className="font-medium text-muted-foreground">SKU</dt>
                  <dd className="min-w-0 break-words">{productDetails.sku}</dd>
                  <dt className="font-medium text-muted-foreground">Barcode</dt>
                  <dd className="min-w-0 break-words">{productDetails.barcode}</dd>
                  <dt className="font-medium text-muted-foreground">Cost price</dt>
                  <dd className="min-w-0 break-words tabular-nums">{formattedProductCost}</dd>
                </dl>
                <div className="mt-3">
                  <MarkdownCreditScopeBadge
                    creditScope={productDetails.creditScope ?? 'NO_CREDIT'}
                    creditScopeReason={productDetails.creditScopeReason ?? 'NO_CREDIT'}
                    creditSupplierId={productDetails.creditSupplierId ?? null}
                    creditSupplierName={productDetails.creditSupplierName ?? null}
                  />
                </div>
              </section>
            )}
          </div>

          <section aria-labelledby="markdown-inputs-heading" className="min-w-0 space-y-4">
            <div>
              <h2 id="markdown-inputs-heading" className="font-heading text-lg font-semibold">
                Price and expiry
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Use the current cost price and product expiry date to calculate the markdown action.
              </p>
            </div>
            <form noValidate onSubmit={calculateMarkdown} className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="costPrice">Cost price (AUD)</Label>
                <Input
                  ref={costPriceRef}
                  id="costPrice"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  // Read-only (not disabled) keeps the catalog cost focusable and legible.
                  readOnly={hasProductCost}
                  aria-required="true"
                  aria-invalid={validationError?.field === 'costPrice' || undefined}
                  aria-describedby={
                    [
                      hasProductCost ? COST_PRICE_HINT_ID : null,
                      validationError?.field === 'costPrice' ? VALIDATION_ERROR_ID : null,
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  className="min-h-11 read-only:bg-semantic-surface-2"
                />
                {hasProductCost && (
                  <p id={COST_PRICE_HINT_ID} className="text-sm text-muted-foreground">
                    From the product catalog. Scan another product to change it.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiryDate">Expiry date</Label>
                <Input
                  ref={expiryDateRef}
                  id="expiryDate"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  aria-required="true"
                  aria-invalid={validationError?.field === 'expiryDate' || undefined}
                  aria-describedby={
                    validationError?.field === 'expiryDate' ? VALIDATION_ERROR_ID : undefined
                  }
                  className="min-h-11"
                />
              </div>
              <MarkdownMatricesNotice {...markdownConfig} />
              <Button
                type="submit"
                size="lg"
                className="min-h-11 w-full"
                disabled={markdownConfig.status !== 'ready'}
              >
                Calculate markdown
              </Button>
              {validationError && (
                <p
                  id={VALIDATION_ERROR_ID}
                  role="alert"
                  className="min-w-0 break-words text-sm text-semantic-critical-muted-foreground"
                >
                  {validationError.message}
                </p>
              )}
              <section
                role="status"
                aria-live="polite"
                aria-label="Markdown result"
                className="min-w-0 rounded-md border bg-semantic-surface-2 p-4"
              >
                {markdownResult ? (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                    <dt className="font-medium text-muted-foreground">Status</dt>
                    <dd className="min-w-0 break-words font-semibold">{markdownResult.status}</dd>
                    <dt className="font-medium text-muted-foreground">Markdown value</dt>
                    <dd className="min-w-0 break-words font-semibold tabular-nums">
                      {currencyFormatter.format(markdownResult.value)}
                    </dd>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No markdown calculated yet. Scan a product or enter cost and expiry details.
                  </p>
                )}
              </section>
            </form>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
