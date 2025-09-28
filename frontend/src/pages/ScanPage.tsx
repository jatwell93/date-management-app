import React, { useState, useEffect } from "react";
import { Scanner } from "../components/Scanner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { offlineStorage } from "../lib/offline-storage";
import { isWithinMarkdownPeriod, calculateMarkdownPrice } from "../lib/utils";

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

interface MarkdownCalculation {
  expiryDate: string;
  daysToExpiry: number;
  markdownPercentage: number;
  markdownPrice: number;
}

export function ScanPage({ token }: ScanPageProps) {
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(
    null,
  );
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [selectedSubDepartment, setSelectedSubDepartment] = useState<string>("");
  const [storeAreas, setStoreAreas] = useState<StoreArea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showNewProductForm, setShowNewProductForm] = useState<boolean>(false);
  const [newProductName, setNewProductName] = useState<string>("");
  const [newProductSKU, setNewProductSKU] = useState<string>("");
  const [newProductCostPrice, setNewProductCostPrice] = useState<string>("");
  const [markdownPrice, setMarkdownPrice] = useState<number | null>(null);
  const [markdownCalculations, setMarkdownCalculations] = useState<MarkdownCalculation[] | null>(null);

  useEffect(() => {
    const fetchStoreAreas = async () => {
      if (!token) return;
      try {
        const response = await fetch("http://localhost:3001/store-areas", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          throw new Error("Failed to fetch store areas");
        }
        const data = await response.json();
        setStoreAreas(data);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("An unknown error occurred");
        }
      }
    };
    fetchStoreAreas();
  }, [token]);

  useEffect(() => {
    if (productDetails && expiryDate) {
      const isMarkdown = isWithinMarkdownPeriod(expiryDate, 3);
      if (isMarkdown) {
        setMarkdownPrice(calculateMarkdownPrice(productDetails.cost_price, 20)); // Assuming 20% markdown
      } else {
        setMarkdownPrice(null);
      }
    } else {
      setMarkdownPrice(null);
    }
  }, [productDetails, expiryDate]);

  const handleBarcodeScan = async (barcode: string) => {
    setScannedBarcode(barcode);
    setProductDetails(null);
    setError(null);
    setSuccessMessage(null);
    setShowNewProductForm(false);
    setMarkdownPrice(null);
    setMarkdownCalculations(null);

    if (!token) {
      setError("Authentication token is missing.");
      return;
    }

    try {
      const response = await fetch(
        `http://localhost:3001/products?barcode=${barcode}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (response.status === 404) {
        setShowNewProductForm(true);
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to fetch product details");
      }

      const product = await response.json();
      setProductDetails(product);

      // Fetch inventory items for this product to check for markdown opportunities
      try {
        const inventoryResponse = await fetch(
          `http://localhost:3001/inventory-items/product/${product.id}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (inventoryResponse.ok) {
          const inventoryItems: InventoryItem[] = await inventoryResponse.json();

          // Calculate markdowns for each inventory item
          const calculations: MarkdownCalculation[] = inventoryItems
            .filter(item => {
              // Only consider items that are within the markdown periods (next 3 months)
              const expiryDate = new Date(item.expiry_date);
              const today = new Date();
              const daysToExpiry = Math.ceil(
                (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
              );
              return daysToExpiry <= 90; // Within 3 months
            })
            .map(item => {
              const expiryDate = new Date(item.expiry_date);
              const today = new Date();
              const daysToExpiry = Math.ceil(
                (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
              );

              // Calculate markdown percentage based on days to expiry
              let markdownPercentage = 0;
              if (daysToExpiry <= 30) { // Within 1 month - 20% discount
                markdownPercentage = -20;
              } else if (daysToExpiry <= 60) { // Within 2 months - original price
                markdownPercentage = 0;
              } else if (daysToExpiry <= 90) { // Within 3 months - 20% markup
                markdownPercentage = 20;
              }

              const markdownPrice = calculateMarkdownPrice(product.cost_price, markdownPercentage);

              return {
                expiryDate: item.expiry_date,
                daysToExpiry,
                markdownPercentage,
                markdownPrice,
              };
            });

          setMarkdownCalculations(calculations);
        }
      } catch (inventoryErr: unknown) {
        console.error("Error fetching inventory items:", inventoryErr);
        // Don't set an error here as it's not critical for the scan operation
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
    }
  };

  const handleAddNewProduct = async () => {
    if (
      !token ||
      !scannedBarcode ||
      !newProductName ||
      !newProductSKU ||
      !newProductCostPrice
    ) {
      setError("Please fill all new product details.");
      return;
    }

    try {
      const response = await fetch("http://localhost:3001/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          barcode: scannedBarcode,
          name: newProductName,
          sku: newProductSKU,
          cost_price: parseFloat(newProductCostPrice),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to add new product");
      }

      const newProduct = await response.json();
      setProductDetails(newProduct);
      setSuccessMessage(
        "New product added successfully! Now add inventory details.",
      );
      setShowNewProductForm(false);
      setNewProductName("");
      setNewProductSKU("");
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
      setSuccessMessage(null);
    }
  };

  const handleSubmit = async () => {
    if (!token || !productDetails || !expiryDate || !selectedLocationId) {
      setError("Please fill all product and inventory details including location.");
      return;
    }

    // Further validate that the parsed locationId is a valid number
    const parsedLocationId = parseInt(selectedLocationId);
    if (isNaN(parsedLocationId)) {
      setError("Please select a valid location.");
      return;
    }

    // Get the selected store area to extract the subDepartment
    const selectedArea = storeAreas.find(area => area.id === parsedLocationId);
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
        setSuccessMessage("Offline: Inventory item saved for synchronization.");
        // Reset form
        setScannedBarcode(null);
        setProductDetails(null);
        setExpiryDate("");
        setSelectedLocationId("");
        setSelectedSubDepartment("");
        setError(null);
        setMarkdownPrice(null);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("An unknown error occurred");
        }
        setSuccessMessage(null);
      }
      return;
    }

    try {
      const response = await fetch("http://localhost:3001/inventory-items", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(inventoryItem),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to add inventory item");
      }

      setSuccessMessage("Inventory item added successfully!");
      // Reset form
      setScannedBarcode(null);
      setProductDetails(null);
      setExpiryDate("");
      setSelectedLocationId("");
      setSelectedSubDepartment("");
      setError(null);
      setMarkdownPrice(null);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
      setSuccessMessage(null);
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-3xl">
      <Card className="w-full mx-auto border border-border bg-card text-card-foreground shadow-lg">
        <CardHeader className="bg-muted/50 border-b border-border">
          <CardTitle className="text-2xl font-bold text-center">Inventory Scan</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <Scanner onScan={handleBarcodeScan} markdownCalculations={markdownCalculations} />
          {error && (
            <p className="text-inventory-error-500 text-sm text-center mt-4">
              Error: {error}
            </p>
          )}
          {successMessage && (
            <p className="text-inventory-success-500 text-sm text-center mt-4">
              {successMessage}
            </p>
          )}
          {scannedBarcode &&
            !productDetails &&
            !error &&
            !successMessage &&
            showNewProductForm && (
              <div className="mt-6 p-4 border rounded-md bg-muted">
                <p className="text-center font-semibold text-foreground">
                  Product not found for barcode: {scannedBarcode}
                </p>
                <p className="text-center text-sm mb-4 text-muted-foreground">
                  Please add new product details:
                </p>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="newProductName" className="text-foreground">Product Name</Label>
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
                    <Label htmlFor="newProductSKU" className="text-foreground">SKU</Label>
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
                    <Label htmlFor="newProductCostPrice" className="text-foreground">Cost Price</Label>
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
                    <p className="text-inventory-warning-500 font-semibold mt-1">
                      Markdown Price (20% off): ${markdownPrice.toFixed(2)}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6 space-y-6">
                <div>
                  <Label htmlFor="expiryDate" className="text-foreground">Expiry Date</Label>
                  <Input
                    id="expiryDate"
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="mt-1 border-input bg-background text-foreground w-full"
                  />
                </div>
                <div>
                  <Label htmlFor="location" className="text-foreground">Location</Label>
                  <Select
                    onValueChange={setSelectedLocationId}
                    value={selectedLocationId}
                  >
                    <SelectTrigger className="w-full mt-1 border-input bg-background text-foreground">
                      <SelectValue placeholder="Select a location" />
                    </SelectTrigger>
                    <SelectContent className="border-input bg-background text-foreground">
                      {storeAreas.map((area) => (
                        <SelectItem key={area.id} value={area.id.toString()}>
                          {area.name}{area.subDepartment ? ` (${area.subDepartment})` : ''}
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
        </CardContent>
      </Card>
    </div>
  );
}
