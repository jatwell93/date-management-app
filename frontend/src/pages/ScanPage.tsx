import React, { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { Scanner } from '../components/Scanner';
import { HandheldScanner } from '../components/HandheldScanner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { offlineStorage } from '../lib/offline-storage';
import { calculateMarkdownPrice, getMarkdownBandConfig } from '@shared/markdown';
import { useMarkdownMatrices } from '../hooks/useMarkdownMatrix';
import type { MarkdownCreditContext } from '@shared/markdown-credit-context';
import { MarkdownCreditScopeBadge } from '../components/MarkdownCreditScopeBadge';
import { MarkdownMatricesNotice } from '../components/MarkdownMatricesNotice';
import { apiService } from '../lib/api.service';
import { parseGS1Barcode } from '../lib/gs1-parser';
import { synchronizeOfflineData } from '../lib/sync-manager';
import { useFreshApiToken } from '../hooks/useFreshApiToken';
import { useHandheldDetectionContext } from '../contexts/HandheldContext';
import { HardwareScanResult } from '../types/handheld';
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
} from '../components/ui/alert-dialog';

interface ScanPageProps {
  token: string | null;
}

interface StoreArea {
  id: number;
  name: string;
  subDepartment?: string;
}

interface ProductDetails extends MarkdownCreditContext {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  costPrice?: number | null;
  retailPrice?: number | null;
}

interface InventoryItem {
  id: number;
  productId: number;
  expiryDate: string;
  locationId: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface RecentInventoryItem {
  id: number;
  productId: number;
  expiryDate: string;
  locationId: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function formatExpiryDateForCopy(expiryDate: string): string {
  return new Date(expiryDate).toLocaleDateString('en-AU', {
    timeZone: 'Australia/Sydney',
  });
}

export function ScanPage({ token }: ScanPageProps) {
  const getFreshApiToken = useFreshApiToken(token);
  const markdownConfig = useMarkdownMatrices(token);
  const { isHandheld } = useHandheldDetectionContext();
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(null);
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [, setSelectedSubDepartment] = useState<string>('');
  const [storeAreas, setStoreAreas] = useState<StoreArea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showNewProductForm, setShowNewProductForm] = useState<boolean>(false);
  const [newProductName, setNewProductName] = useState<string>('');
  const [newProductSKU, setNewProductSKU] = useState<string>('');
  const [newProductCostPrice, setNewProductCostPrice] = useState<string>('');
  const [markdownPrice, setMarkdownPrice] = useState<number | null>(null);
  const [markdownPercentage, setMarkdownPercentage] = useState<number | null>(null);
  const [isExpiredStock, setIsExpiredStock] = useState<boolean>(false);
  const [recentEntries, setRecentEntries] = useState<RecentInventoryItem[] | null>(null);
  const [isAlertDialogOpen, setAlertDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);

  // Effect to scroll error messages into view on handheld devices
  useEffect(() => {
    if (error && isHandheld) {
      const errorElement = document.querySelector('[role="alert"]');
      if (errorElement) {
        errorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [error, isHandheld]);

  useEffect(() => {
    const fetchStoreAreas = async () => {
      if (!token) return;
      try {
        const authToken = await getFreshApiToken('scan-store-areas');
        const data = await apiService.get<StoreArea[]>('/store-areas', authToken);
        setStoreAreas(data);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred');
        }
      }
    };
    fetchStoreAreas();
  }, [token, getFreshApiToken]);

  useEffect(() => {
    if (productDetails && expiryDate) {
      const expiry = new Date(expiryDate);
      const today = new Date();
      const daysToExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      const costPrice = productDetails.costPrice;
      const isExpired = daysToExpiry <= 0;
      if (isExpired) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: derives markdown pricing state from productDetails/expiryDate
        setMarkdownPrice(null);
        setMarkdownPercentage(null);
        setIsExpiredStock(true);
        return;
      }

      setIsExpiredStock(false);

      // Price against the org's configured matrix (issue #338): the band picks the
      // percentage and whether it comes off cost or retail. Retail falls back to
      // cost when the product has none, so no in-window item is left unpriced.
      const markdownMatrix = markdownConfig.matrices?.[productDetails.creditScope ?? 'NO_CREDIT'];
      if (markdownConfig.status !== 'ready' || !markdownMatrix) {
        setMarkdownPrice(null);
        setMarkdownPercentage(null);
        return;
      }
      const band = getMarkdownBandConfig(daysToExpiry, markdownMatrix);
      if (band && typeof costPrice === 'number' && Number.isFinite(costPrice)) {
        const retailPrice =
          typeof productDetails.retailPrice === 'number' &&
          Number.isFinite(productDetails.retailPrice)
            ? productDetails.retailPrice
            : null;
        setMarkdownPrice(
          calculateMarkdownPrice({ costPrice, retailPrice }, daysToExpiry, markdownMatrix),
        );
        setMarkdownPercentage(band.percentage);
        return;
      }

      setMarkdownPrice(null);
      setMarkdownPercentage(null);
      setIsExpiredStock(false);
    } else {
      setMarkdownPrice(null);
      setMarkdownPercentage(null);
      setIsExpiredStock(false);
    }
  }, [productDetails, expiryDate, markdownConfig.matrices, markdownConfig.status]);

  const resetScanState = (barcode: string) => {
    setScannedBarcode(barcode);
    setProductDetails(null);
    setRecentEntries(null);
    setError(null);
    setSuccessMessage(null);
    setShowNewProductForm(false);
    setMarkdownPrice(null);
    setMarkdownPercentage(null);
    setIsExpiredStock(false);
  };

  const resolveBarcodeForLookup = (rawBarcode: string): string => {
    try {
      const gs1Data = parseGS1Barcode(rawBarcode);
      if (gs1Data.expiryDate) {
        setExpiryDate(gs1Data.expiryDate);
      }
      return gs1Data.gtin || rawBarcode;
    } catch (gs1Error) {
      if (gs1Error instanceof Error) {
        Sentry.captureException(gs1Error, {
          tags: { feature: 'scan-page', area: 'gs1-parse' },
        });
      }
      return rawBarcode;
    }
  };

  const fetchProductWithFallback = async (
    barcode: string,
    authToken: string,
  ): Promise<ProductDetails | null> => {
    const isSkuSearch = barcode.length <= 8;
    const primaryEndpoint = isSkuSearch
      ? `/products/by-sku/${barcode}`
      : `/products/by-barcode/${barcode}`;
    const fallbackEndpoint = isSkuSearch
      ? `/products/by-barcode/${barcode}`
      : `/products/by-sku/${barcode}`;

    const primaryResult = await apiService.get<ProductDetails>(primaryEndpoint, authToken);
    if (primaryResult) {
      return primaryResult;
    }

    return apiService.get<ProductDetails>(fallbackEndpoint, authToken);
  };

  const loadProductRelatedData = async (product: ProductDetails, authToken: string) => {
    try {
      await apiService.get<InventoryItem[]>(
        `/inventory-items/by-barcode/${product.barcode}`,
        authToken,
      );
    } catch (inventoryErr: unknown) {
      if (inventoryErr instanceof Error) {
        Sentry.captureException(inventoryErr, {
          tags: { feature: 'scan-page', area: 'inventory-items' },
        });
      }
    }

    try {
      const recent: RecentInventoryItem[] = await apiService.get<RecentInventoryItem[]>(
        `/inventory-items/recent/product/${product.id}`,
        authToken,
      );
      setRecentEntries(recent);
    } catch (recentErr: unknown) {
      if (recentErr instanceof Error) {
        Sentry.captureException(recentErr, {
          tags: { feature: 'scan-page', area: 'recent-entries' },
        });
      }
    }
  };

  const handleBarcodeScan = async (result: HardwareScanResult) => {
    const rawBarcode = result.barcode;
    resetScanState(rawBarcode);

    if (!token) {
      setError('Sign in again before scanning inventory.');
      return;
    }

    try {
      const barcodeToSearch = resolveBarcodeForLookup(rawBarcode);
      const authToken = await getFreshApiToken('scan-product-lookup');
      const product = await fetchProductWithFallback(barcodeToSearch, authToken || token);

      if (!product) {
        setShowNewProductForm(true);
        return;
      }

      setProductDetails(product);

      await loadProductRelatedData(product, authToken || token);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes('404')) {
          setShowNewProductForm(true);
        } else {
          setError(err.message);
        }
      } else {
        setError('An unknown error occurred');
      }
    }
  };

  const handleAddNewProduct = async () => {
    if (!token || !scannedBarcode || !newProductName || !newProductSKU || !newProductCostPrice) {
      setError('Enter product name, SKU, and cost price before creating the product.');
      return;
    }

    try {
      const authToken = await getFreshApiToken('scan-product-create');
      const newProduct = await apiService.post<ProductDetails>(
        '/products',
        {
          barcode: scannedBarcode,
          name: newProductName,
          sku: newProductSKU,
          costPrice: parseFloat(newProductCostPrice),
        },
        authToken,
      );
      setProductDetails(newProduct);
      setSuccessMessage('Product created. Add expiry details next.');
      setShowNewProductForm(false);
      setNewProductName('');
      setNewProductSKU('');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred');
      }
      setSuccessMessage(null);
    }
  };

  const handleSubmit = async () => {
    if (!token || !productDetails || !expiryDate || !selectedLocationId) {
      setError('Select an expiry date and location before saving this item.');
      return;
    }

    const parsedLocationId = parseInt(selectedLocationId);
    if (Number.isNaN(parsedLocationId)) {
      setError('Please select a valid location.');
      return;
    }

    const selectedArea = storeAreas.find((area) => area.id === parsedLocationId);
    const subDepartment = selectedArea?.subDepartment || null;

    const inventoryItem = {
      productId: productDetails.id,
      expiryDate: expiryDate,
      locationId: parsedLocationId,
      subDepartment: subDepartment,
    };

    if (!navigator.onLine) {
      try {
        const key = `pending-inventory-item-${Date.now()}`;
        await offlineStorage.setItem(key, inventoryItem);
        setSuccessMessage('Offline: expiry item queued for sync.');
        setScannedBarcode(null);
        setProductDetails(null);
        setExpiryDate('');
        setSelectedLocationId('');
        setSelectedSubDepartment('');
        setError(null);
        setMarkdownPrice(null);
        setMarkdownPercentage(null);
        setIsExpiredStock(false);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred');
        }
        setSuccessMessage(null);
      }
      return;
    }

    try {
      const authToken = await getFreshApiToken('scan-inventory-submit');

      await apiService.post(
        '/inventory-items',
        {
          productId: productDetails.id,
          expiryDate: expiryDate,
          locationId: parsedLocationId,
        },
        authToken,
      );

      setSuccessMessage('Expiry item saved to inventory.');
      setScannedBarcode(null);
      setProductDetails(null);
      setExpiryDate('');
      setSelectedLocationId('');
      setSelectedSubDepartment('');
      setError(null);
      setMarkdownPrice(null);
      setMarkdownPercentage(null);
      setIsExpiredStock(false);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred');
      }
      setSuccessMessage(null);
    }
  };

  const handleDeleteRecentEntry = (entryId: number) => {
    setItemToDelete(entryId);
    setAlertDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!token || !itemToDelete) return;

    try {
      const authToken = await getFreshApiToken('scan-recent-entry-delete');
      await apiService.delete(`/inventory-items/${itemToDelete}`, authToken);
      setSuccessMessage('Expiry entry deleted.');
      setAlertDialogOpen(false);
      setItemToDelete(null);
      // Refresh recent entries if we have product details
      if (productDetails) {
        const recent: RecentInventoryItem[] = await apiService.get<RecentInventoryItem[]>(
          `/inventory-items/recent/product/${productDetails.id}`,
          authToken,
        );
        setRecentEntries(recent);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred');
      }
    }
  };

  const _handleSyncNow = async () => {
    if (!token) {
      setError('Sign in again before syncing inventory.');
      return;
    }

    try {
      setError(null);
      await synchronizeOfflineData(() => getFreshApiToken('scan-offline-sync'));
      setSuccessMessage('Inventory sync complete.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(`Inventory sync failed: ${err.message}`);
      } else {
        setError('Inventory sync failed. Try again when the connection is stable.');
      }
    }
  };

  const entryPendingDelete =
    itemToDelete === null
      ? null
      : recentEntries?.find((entry) => entry.id === itemToDelete) || null;

  const renderContent = () => (
    <div className={isHandheld ? 'h-full w-full p-0' : 'container mx-auto p-4 max-w-3xl'}>
      <Card
        className={
          isHandheld
            ? 'w-full h-full border-0 rounded-none shadow-none bg-card text-card-foreground'
            : 'w-full mx-auto border border-border bg-card text-card-foreground shadow-lg'
        }
      >
        {!isHandheld && (
          <CardHeader className="bg-muted/50 border-b border-border">
            <CardTitle className="text-2xl font-bold font-heading text-center">
              Inventory Scan
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className={isHandheld ? 'p-0 h-full' : 'p-6'}>
          {isHandheld ? (
            <HandheldScanner onScan={handleBarcodeScan} />
          ) : (
            <Scanner onScan={handleBarcodeScan} />
          )}
          {error && (
            <div
              className="bg-semantic-critical-muted border border-semantic-critical text-semantic-critical-muted-foreground px-4 py-3 rounded relative text-center mt-4"
              role="alert"
            >
              <span className="block sm:inline">Error: {error}</span>
            </div>
          )}
          {successMessage && (
            <div
              className="bg-semantic-success-muted border border-semantic-success text-semantic-success-muted-foreground px-4 py-3 rounded relative text-center mt-4"
              role="alert"
            >
              <span className="block sm:inline">{successMessage}</span>
            </div>
          )}
          {scannedBarcode && !productDetails && !error && !successMessage && showNewProductForm && (
            <div className="mt-6 p-4 border rounded-md bg-muted">
              <p className="text-center font-semibold text-foreground">
                No catalog match for barcode {scannedBarcode}
              </p>
              <p className="text-center text-sm mb-4 text-muted-foreground">
                Create a product record before adding expiry stock.
              </p>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="newProductName" className="text-foreground">
                    Product Name
                  </Label>
                  <Input
                    id="newProductName"
                    type="text"
                    value={newProductName}
                    onChange={(e) => setNewProductName(e.target.value)}
                    className="mt-1 border-input bg-background text-foreground"
                    placeholder="Enter product name"
                  />
                </div>
                <div>
                  <Label htmlFor="newProductSKU" className="text-foreground">
                    SKU
                  </Label>
                  <Input
                    id="newProductSKU"
                    type="text"
                    value={newProductSKU}
                    onChange={(e) => setNewProductSKU(e.target.value)}
                    className="mt-1 border-input bg-background text-foreground"
                    placeholder="Enter SKU"
                  />
                </div>
                <div>
                  <Label htmlFor="newProductCostPrice" className="text-foreground">
                    Cost Price
                  </Label>
                  <Input
                    id="newProductCostPrice"
                    type="number"
                    value={newProductCostPrice}
                    onChange={(e) => setNewProductCostPrice(e.target.value)}
                    className="mt-1 border-input bg-background text-foreground"
                    placeholder="Enter cost price"
                  />
                </div>
                <Button onClick={handleAddNewProduct} className="w-full">
                  Create product
                </Button>
              </div>
            </div>
          )}
          {productDetails && (
            <div className="mt-6 p-4 border rounded-md bg-muted">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="font-semibold text-foreground">Product Details:</p>
                  <p className="text-foreground">
                    <span className="font-medium">Name:</span> {productDetails.name}
                  </p>
                  <p className="text-foreground">
                    <span className="font-medium">SKU:</span> {productDetails.sku}
                  </p>
                  <p className="text-foreground">
                    <span className="font-medium">Barcode:</span> {productDetails.barcode}
                  </p>
                </div>
                <div>
                  <p className="text-foreground">
                    <span className="font-medium">Cost Price:</span>{' '}
                    {typeof productDetails.costPrice === 'number' &&
                    Number.isFinite(productDetails.costPrice)
                      ? `$${productDetails.costPrice.toFixed(2)}`
                      : 'Not available'}
                  </p>
                  <div className="mt-2">
                    <MarkdownCreditScopeBadge
                      creditScope={productDetails.creditScope ?? 'NO_CREDIT'}
                      creditScopeReason={productDetails.creditScopeReason ?? 'NO_CREDIT'}
                      creditSupplierId={productDetails.creditSupplierId ?? null}
                      creditSupplierName={productDetails.creditSupplierName ?? null}
                    />
                  </div>

                  <MarkdownMatricesNotice {...markdownConfig} />
                  {markdownPrice !== null && markdownPercentage !== null && (
                    <p className="text-semantic-warning font-semibold mt-1">
                      Markdown Price ({markdownPercentage}% off): ${markdownPrice.toFixed(2)}
                    </p>
                  )}
                  {isExpiredStock && (
                    <div className="mt-2">
                      <Badge variant="error">Expired</Badge>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 space-y-6">
                <div>
                  <Label htmlFor="expiryDate" className="text-foreground">
                    Expiry Date
                  </Label>
                  <Input
                    id="expiryDate"
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="mt-1 border-input bg-background text-foreground w-full"
                  />
                </div>
                <div>
                  <Label htmlFor="location" className="text-foreground">
                    Location
                  </Label>
                  <Select onValueChange={setSelectedLocationId} value={selectedLocationId}>
                    <SelectTrigger className="w-full mt-1 border-input bg-background text-foreground">
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
                <Button onClick={handleSubmit} className="w-full">
                  Save expiry item
                </Button>
              </div>
            </div>
          )}
          {productDetails && recentEntries && recentEntries.length > 0 && (
            <div className="mt-8 p-4 border rounded-md bg-muted">
              <h3 className="font-semibold text-lg text-foreground mb-4">Recent Entries</h3>
              <div className="space-y-3">
                {recentEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-3 bg-background border rounded-md"
                  >
                    <div>
                      <p className="text-foreground">
                        <span className="font-medium">Expiry Date:</span>{' '}
                        {new Date(entry.expiryDate).toLocaleDateString('en-AU', {
                          timeZone: 'Australia/Sydney',
                        })}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        Added:{' '}
                        {new Date(entry.createdAt).toLocaleString('en-AU', {
                          timeZone: 'Australia/Sydney',
                        })}
                      </p>
                    </div>
                    <AlertDialog
                      open={isAlertDialogOpen && itemToDelete === entry.id}
                      onOpenChange={setAlertDialogOpen}
                    >
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteRecentEntry(entry.id)}
                        >
                          Delete entry
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete expiry entry?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {entryPendingDelete
                              ? `This removes the ${formatExpiryDateForCopy(
                                  entryPendingDelete.expiryDate,
                                )} expiry entry for ${productDetails.name}. This cannot be undone.`
                              : 'This removes the selected expiry entry. This cannot be undone.'}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={confirmDelete}>
                            Delete entry
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <>
      <div data-testid="scan-page-main">{renderContent()}</div>
    </>
  );
}
