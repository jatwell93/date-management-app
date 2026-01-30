import React, { useState, useEffect } from 'react';
import { Scanner } from '../components/Scanner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { offlineStorage } from '../lib/offline-storage';
import { isWithinMarkdownPeriod, calculateMarkdownPrice } from '../lib/utils';
import { apiService } from '../lib/api.service';
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

interface ProductDetails {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  cost_price: number;
}

interface InventoryItem {
  id: number;
  product_id: number;
  expiry_date: string;
  location_id: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface RecentInventoryItem {
  id: number;
  product_id: number;
  expiry_date: string;
  location_id: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export function ScanPage({ token }: ScanPageProps) {
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
  const [recentEntries, setRecentEntries] = useState<RecentInventoryItem[] | null>(null);
  const [isAlertDialogOpen, setAlertDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);

  useEffect(() => {
    const fetchStoreAreas = async () => {
      if (!token) return;
      try {
        const data = await apiService.get<StoreArea[]>('/store-areas', token);
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
  }, [token]);

  useEffect(() => {
    if (productDetails && expiryDate) {
      const expiry = new Date(expiryDate);
      const today = new Date();
      const daysToExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      const isMarkdown = isWithinMarkdownPeriod(expiryDate, 90); // Check if within 90 days
      if (isMarkdown) {
        setMarkdownPrice(calculateMarkdownPrice(productDetails.cost_price, daysToExpiry));
      } else {
        setMarkdownPrice(null);
      }
    } else {
      setMarkdownPrice(null);
    }
  }, [productDetails, expiryDate]);

  const handleBarcodeScan = async (input: string) => {
    setScannedBarcode(input);
    setProductDetails(null);
    setRecentEntries(null); // Reset recent entries when scanning a new item
    setError(null);
    setSuccessMessage(null);
    setShowNewProductForm(false);
    setMarkdownPrice(null);

    if (!token) {
      setError('Authentication token is missing.');
      return;
    }

    try {
      let product: ProductDetails | null = null;

      const isSkuSearch = input.length <= 8;

      if (isSkuSearch) {
        product = await apiService.get<ProductDetails>(`/products/by-sku/${input}`, token);
      } else {
        product = await apiService.get<ProductDetails>(`/products/by-barcode/${input}`, token);
      }

      if (!product) {
        if (isSkuSearch) {
          product = await apiService.get<ProductDetails>(`/products/by-barcode/${input}`, token);
        } else {
          product = await apiService.get<ProductDetails>(`/products/by-sku/${input}`, token);
        }
      }

      if (!product) {
        setShowNewProductForm(true);
        return;
      }

      setProductDetails(product);

      try {
        await apiService.get<InventoryItem[]>(
          `/inventory-items/by-barcode/${product.barcode}`,
          token,
        );
      } catch (inventoryErr: unknown) {
        console.error('Error fetching inventory items:', inventoryErr);
      }

      try {
        const recent: RecentInventoryItem[] = await apiService.get<RecentInventoryItem[]>(
          `/inventory-items/recent/product/${product.id}`,
          token,
        );
        console.log('Fetched recent entries:', recent); // Debug log
        setRecentEntries(recent);
      } catch (recentErr: unknown) {
        console.error('Error fetching recent inventory entries:', recentErr);
      }
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
      setError('Please fill all new product details.');
      return;
    }

    try {
      const newProduct = await apiService.post<ProductDetails>(
        '/products',
        {
          barcode: scannedBarcode,
          name: newProductName,
          sku: newProductSKU,
          cost_price: parseFloat(newProductCostPrice),
        },
        token,
      );
      setProductDetails(newProduct);
      setSuccessMessage('New product added successfully! Now add inventory details.');
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
      setError('Please fill all product and inventory details including location.');
      return;
    }

    const parsedLocationId = parseInt(selectedLocationId);
    if (isNaN(parsedLocationId)) {
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
        setSuccessMessage('Offline: Inventory item saved for synchronization.');
        setScannedBarcode(null);
        setProductDetails(null);
        setExpiryDate('');
        setSelectedLocationId('');
        setSelectedSubDepartment('');
        setError(null);
        setMarkdownPrice(null);
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
      await apiService.post(
        '/inventory-items',
        {
          productId: productDetails.id,
          expiryDate: expiryDate,
          locationId: parsedLocationId,
        },
        token,
      );

      setSuccessMessage('Inventory item added successfully!');
      setScannedBarcode(null);
      setProductDetails(null);
      setExpiryDate('');
      setSelectedLocationId('');
      setSelectedSubDepartment('');
      setError(null);
      setMarkdownPrice(null);
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
    if (!token || itemToDelete === null) {
      setError('Authentication token is missing or item to delete is not specified.');
      setAlertDialogOpen(false);
      return;
    }

    try {
      await apiService.delete(`/inventory-items/${itemToDelete}`, token);

      setRecentEntries((prevEntries) =>
        prevEntries ? prevEntries.filter((entry) => entry.id !== itemToDelete) : null,
      );

      setSuccessMessage('Inventory entry deleted successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred while deleting the entry');
      }
    } finally {
      setAlertDialogOpen(false);
      setItemToDelete(null);
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-3xl">
      <Card className="w-full mx-auto border border-border bg-card text-card-foreground shadow-lg">
        <CardHeader className="bg-muted/50 border-b border-border">
          <CardTitle className="text-2xl font-bold text-center">Inventory Scan</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <Scanner onScan={handleBarcodeScan} />
          {error && (
            <div
              className="bg-inventory-error-50 border border-inventory-error-400 text-inventory-error-800 px-4 py-3 rounded relative text-center mt-4"
              role="alert"
            >
              <span className="block sm:inline">Error: {error}</span>
            </div>
          )}
          {successMessage && (
            <div
              className="bg-inventory-success-50 border border-inventory-success-400 text-inventory-success-800 px-4 py-3 rounded relative text-center mt-4"
              role="alert"
            >
              <span className="block sm:inline">{successMessage}</span>
            </div>
          )}
          {scannedBarcode && !productDetails && !error && !successMessage && showNewProductForm && (
            <div className="mt-6 p-4 border rounded-md bg-muted">
              <p className="text-center font-semibold text-foreground">
                Product not found for barcode: {scannedBarcode}
              </p>
              <p className="text-center text-sm mb-4 text-muted-foreground">
                Please add new product details:
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
                <Button
                  onClick={handleAddNewProduct}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  Add New Product
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
                    <span className="font-medium">Cost Price:</span> $
                    {productDetails.cost_price?.toFixed(2)}
                  </p>

                  {markdownPrice !== null && (
                    <p className="text-yellow-500 font-semibold mt-1">
                      Markdown Price (20% off): ${markdownPrice.toFixed(2)}
                    </p>
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
                <Button
                  onClick={handleSubmit}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  Confirm & Save
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
                        {new Date(entry.expiry_date).toLocaleDateString('en-AU', {
                          timeZone: 'Australia/Sydney',
                        })}
                      </p>
                      <p className="text-muted-foreground text-sm">
                        Added:{' '}
                        {new Date(entry.created_at).toLocaleString('en-AU', {
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
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the inventory
                            entry.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={confirmDelete}>Continue</AlertDialogAction>
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
}
