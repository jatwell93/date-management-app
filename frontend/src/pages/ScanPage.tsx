import React, { useState, useEffect, useRef } from 'react';
import * as Sentry from '@sentry/react';
import { Scanner } from '../components/Scanner';
import { HandheldScanner } from '../components/HandheldScanner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { offlineStorage } from '../lib/offline-storage';
import { calendarDaysUntil } from '../lib/utils';
import { calculateMarkdownPrice, getMarkdownBandConfig } from '@shared/markdown';
import { useMarkdownMatrices } from '../hooks/useMarkdownMatrix';
import { apiService } from '../lib/api.service';
import { parseGS1Barcode } from '../lib/gs1-parser';
import { synchronizeOfflineData } from '../lib/sync-manager';
import { useFreshApiToken } from '../hooks/useFreshApiToken';
import { useHandheldDetectionContext } from '../contexts/HandheldContext';
import { HardwareScanResult } from '../types/handheld';
import {
  NewProductForm,
  ProductPanel,
  RecentEntriesList,
  ScanMessages,
  type ProductDetails,
  type RecentInventoryItem,
  type StoreArea,
} from './scan/ScanPageSections';

interface ScanPageProps {
  token: string | null;
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

const LAYOUT_CLASSES = {
  handheld: {
    container: 'h-full w-full p-0',
    card: 'w-full h-full border-0 rounded-none shadow-none bg-card text-card-foreground',
    content: 'p-0 h-full',
    results: 'px-3 pb-6',
  },
  standard: {
    container: 'container mx-auto p-4 max-w-3xl',
    card: 'w-full mx-auto border border-border bg-card text-card-foreground',
    content: 'p-6',
    results: undefined,
  },
} as const;

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
  const errorRef = useRef<HTMLDivElement>(null);

  // Effect to scroll this page's error message into view on handheld devices
  useEffect(() => {
    if (error && isHandheld && errorRef.current) {
      const prefersReducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      errorRef.current.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'center',
      });
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
      const daysToExpiry = calendarDaysUntil(expiryDate);

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
    const requiredFields = [
      token,
      scannedBarcode,
      newProductName,
      newProductSKU,
      newProductCostPrice,
    ];
    if (requiredFields.some((field) => !field)) {
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
      setError(null);
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
    if (!productDetails || [token, expiryDate, selectedLocationId].some((field) => !field)) {
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

  const layout = isHandheld ? LAYOUT_CLASSES.handheld : LAYOUT_CLASSES.standard;
  const awaitingNewProduct = showNewProductForm && !productDetails;
  const showNewProduct = awaitingNewProduct && Boolean(scannedBarcode) && !successMessage;
  const recentList =
    productDetails && recentEntries?.length
      ? { productName: productDetails.name, entries: recentEntries }
      : null;

  const renderContent = () => (
    <div className={layout.container}>
      <Card className={layout.card}>
        {isHandheld ? (
          <h1 className="sr-only">Inventory scan</h1>
        ) : (
          <CardHeader className="bg-muted/50 border-b border-border">
            <CardTitle>
              <h1 className="text-2xl font-bold font-heading">Inventory scan</h1>
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className={layout.content}>
          {isHandheld ? (
            <HandheldScanner onScan={handleBarcodeScan} />
          ) : (
            <Scanner onScan={handleBarcodeScan} />
          )}
          <div className={layout.results}>
            <ScanMessages error={error} successMessage={successMessage} errorRef={errorRef} />
            {showNewProduct && (
              <NewProductForm
                barcode={scannedBarcode ?? ''}
                name={newProductName}
                sku={newProductSKU}
                costPrice={newProductCostPrice}
                onNameChange={setNewProductName}
                onSkuChange={setNewProductSKU}
                onCostPriceChange={setNewProductCostPrice}
                onSubmit={handleAddNewProduct}
              />
            )}
            {productDetails && (
              <ProductPanel
                product={productDetails}
                markdownConfig={markdownConfig}
                markdownPrice={markdownPrice}
                markdownPercentage={markdownPercentage}
                isExpiredStock={isExpiredStock}
                expiryDate={expiryDate}
                onExpiryDateChange={setExpiryDate}
                locationId={selectedLocationId}
                onLocationChange={setSelectedLocationId}
                storeAreas={storeAreas}
                onSubmit={handleSubmit}
              />
            )}
            {recentList && (
              <RecentEntriesList
                {...recentList}
                pendingDeleteId={itemToDelete}
                isDeleteDialogOpen={isAlertDialogOpen}
                onDeleteDialogOpenChange={setAlertDialogOpen}
                onRequestDelete={handleDeleteRecentEntry}
                onConfirmDelete={confirmDelete}
              />
            )}
          </div>
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
