import React, { useMemo, useState } from 'react';
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
  const [validationError, setValidationError] = useState<string | null>(null);
  // Load the org's markdown matrix so the calculator honors configured bands and
  // basis (issue #338). Falls back to the default ladder if it cannot be loaded.
  const markdownConfig = useMarkdownMatrices(token);

  const hasProductCost =
    typeof productDetails?.costPrice === 'number' && Number.isFinite(productDetails.costPrice);

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
    setScannedInput(input);
    setProductDetails(null);
    setMarkdownResult(null);
    setError(null);
    setValidationError(null);

    if (!token) {
      setError('Sign in again before scanning a product, then retry the barcode or SKU.');
      return;
    }

    try {
      let product: ProductDetails | null = null;
      const isSkuSearch = input.length <= 8;
      const apiToken = await getFreshApiToken('markdown-product-lookup');

      if (isSkuSearch) {
        product = await apiService.get<ProductDetails>(`/products/by-sku/${input}`, apiToken);
      } else {
        product = await apiService.get<ProductDetails>(`/products/by-barcode/${input}`, apiToken);
      }

      if (!product) {
        if (isSkuSearch) {
          product = await apiService.get<ProductDetails>(`/products/by-barcode/${input}`, apiToken);
        } else {
          product = await apiService.get<ProductDetails>(`/products/by-sku/${input}`, apiToken);
        }
      }

      if (!product) {
        setError(
          'No product matched that barcode or SKU. Enter the cost price and expiry date manually.',
        );
        return;
      }

      setProductDetails(product);
      if (typeof product.costPrice === 'number' && Number.isFinite(product.costPrice)) {
        setCostPrice(String(product.costPrice));
      } else {
        setCostPrice('');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('404')) {
        setError(
          'No product matched that barcode or SKU. Enter the cost price and expiry date manually.',
        );
      } else {
        setError(
          'We could not look up that product. Enter the cost price and expiry date manually.',
        );
      }
    }
  };

  const calculateMarkdown = () => {
    if (markdownConfig.status !== 'ready' || !markdownConfig.matrices) {
      setMarkdownResult(null);
      return;
    }
    const parsedCostPrice = Number(costPrice);

    setValidationError(null);

    if (!Number.isFinite(parsedCostPrice) || parsedCostPrice <= 0) {
      setValidationError('Enter a cost price greater than 0 before calculating a markdown.');
      setMarkdownResult(null);
      return;
    }

    if (!expiryDate) {
      setValidationError('Choose an expiry date before calculating a markdown.');
      setMarkdownResult(null);
      return;
    }

    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

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
        <CardTitle>Expiry markdown calculator</CardTitle>
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

            {scannedInput && (
              <p
                role="status"
                aria-label="Last scanned code"
                className="min-w-0 break-words text-sm text-muted-foreground"
              >
                Last scanned: {scannedInput}
              </p>
            )}

            {error && (
              <p role="alert" className="min-w-0 break-words text-sm text-semantic-critical">
                {error}
              </p>
            )}

            {productDetails && (
              <section
                role="status"
                aria-label="Scanned product"
                className="min-w-0 rounded-md border bg-semantic-surface-2 p-4"
              >
                <h2 className="font-heading text-base font-semibold">Scanned product</h2>
                <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                  <dt className="font-medium text-muted-foreground">Name</dt>
                  <dd className="min-w-0 break-words">{productDetails.name}</dd>
                  <dt className="font-medium text-muted-foreground">SKU</dt>
                  <dd className="min-w-0 break-words">{productDetails.sku}</dd>
                  <dt className="font-medium text-muted-foreground">Barcode</dt>
                  <dd className="min-w-0 break-words">{productDetails.barcode}</dd>
                  <dt className="font-medium text-muted-foreground">Cost price</dt>
                  <dd className="min-w-0 break-words">{formattedProductCost}</dd>
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
            <div className="grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="costPrice">Cost price</Label>
                <Input
                  id="costPrice"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  disabled={hasProductCost}
                  className="min-h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiryDate">Expiry date</Label>
                <Input
                  id="expiryDate"
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="min-h-11"
                />
              </div>
              <MarkdownMatricesNotice {...markdownConfig} />
              <Button
                onClick={calculateMarkdown}
                size="lg"
                className="min-h-11 w-full"
                disabled={markdownConfig.status !== 'ready'}
              >
                Calculate markdown
              </Button>
              {validationError && (
                <p role="alert" className="min-w-0 break-words text-sm text-semantic-critical">
                  {validationError}
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
                    <dd className="min-w-0 break-words font-semibold">
                      {currencyFormatter.format(markdownResult.value)}
                    </dd>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No markdown calculated yet. Scan a product or enter cost and expiry details.
                  </p>
                )}
              </section>
            </div>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
