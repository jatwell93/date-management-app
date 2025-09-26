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

interface ScanPageProps {
  token: string | null;
}

interface StoreArea {
  id: number;
  name: string;
}

interface ProductDetails {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  cost_price: number;
}

export function ScanPage({ token }: ScanPageProps) {
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(
    null,
  );
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [storeAreas, setStoreAreas] = useState<StoreArea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showNewProductForm, setShowNewProductForm] = useState<boolean>(false);
  const [newProductName, setNewProductName] = useState<string>("");
  const [newProductSKU, setNewProductSKU] = useState<string>("");
  const [newProductCostPrice, setNewProductCostPrice] = useState<string>("");

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

  const handleBarcodeScan = async (barcode: string) => {
    setScannedBarcode(barcode);
    setProductDetails(null);
    setError(null);
    setSuccessMessage(null);
    setShowNewProductForm(false);

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
      setNewProductCostPrice("");
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
      setError("Please fill all product and inventory details.");
      return;
    }

    const inventoryItem = {
      product_id: productDetails.id,
      expiry_date: expiryDate,
      location_id: parseInt(selectedLocationId),
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
        setError(null);
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
      setError(null);
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
    <div className="container mx-auto p-4">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-center">Inventory Scan</CardTitle>
        </CardHeader>
        <CardContent>
          <Scanner onScan={handleBarcodeScan} />
          {error && (
            <p className="text-red-500 text-sm text-center mt-4">
              Error: {error}
            </p>
          )}
          {successMessage && (
            <p className="text-green-500 text-sm text-center mt-4">
              {successMessage}
            </p>
          )}
          {scannedBarcode &&
            !productDetails &&
            !error &&
            !successMessage &&
            showNewProductForm && (
              <div className="mt-4 p-4 border rounded-md bg-gray-50">
                <p className="text-center font-semibold">
                  Product not found for barcode: {scannedBarcode}
                </p>
                <p className="text-center text-sm mb-4">
                  Please add new product details:
                </p>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="newProductName">Product Name</Label>
                    <Input
                      id="newProductName"
                      type="text"
                      value={newProductName}
                      onChange={(e) => setNewProductName(e.target.value)}
                      className="mt-1"
                      placeholder="Enter product name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="newProductSKU">SKU</Label>
                    <Input
                      id="newProductSKU"
                      type="text"
                      value={newProductSKU}
                      onChange={(e) => setNewProductSKU(e.target.value)}
                      className="mt-1"
                      placeholder="Enter SKU"
                    />
                  </div>
                  <div>
                    <Label htmlFor="newProductCostPrice">Cost Price</Label>
                    <Input
                      id="newProductCostPrice"
                      type="number"
                      value={newProductCostPrice}
                      onChange={(e) => setNewProductCostPrice(e.target.value)}
                      className="mt-1"
                      placeholder="Enter cost price"
                    />
                  </div>
                  <Button onClick={handleAddNewProduct} className="w-full">
                    Add New Product
                  </Button>
                </div>
              </div>
            )}
          {productDetails && (
            <div className="mt-4 p-4 border rounded-md bg-gray-50">
              <p className="font-semibold">Product Details:</p>
              <p>
                <strong>Name:</strong> {productDetails.name}
              </p>
              <p>
                <strong>SKU:</strong> {productDetails.sku}
              </p>
              <p>
                <strong>Barcode:</strong> {productDetails.barcode}
              </p>
              <p>
                <strong>Cost Price:</strong> $
                {productDetails.cost_price?.toFixed(2)}
              </p>

              <div className="mt-4 space-y-4">
                <div>
                  <Label htmlFor="expiryDate">Expiry Date</Label>
                  <Input
                    id="expiryDate"
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="location">Location</Label>
                  <Select
                    onValueChange={setSelectedLocationId}
                    value={selectedLocationId}
                  >
                    <SelectTrigger className="w-full mt-1">
                      <SelectValue placeholder="Select a location" />
                    </SelectTrigger>
                    <SelectContent>
                      {storeAreas.map((area) => (
                        <SelectItem key={area.id} value={area.id.toString()}>
                          {area.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleSubmit} className="w-full">
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
