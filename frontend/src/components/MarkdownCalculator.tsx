import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Scanner } from "./Scanner"; // Import the Scanner component
import { apiService } from "../lib/api.service";

interface MarkdownCalculatorProps {
  token: string | null;
}

interface ProductDetails {
  id: number;
  name: string;
  sku: string;
  barcode: string;
  cost_price: number;
}

export function MarkdownCalculator({ token }: MarkdownCalculatorProps) {
  const [costPrice, setCostPrice] = useState<number>(0);
  const [expiryDate, setExpiryDate] = useState<string>(""); // YYYY-MM-DD format
  const [markdownStatus, setMarkdownStatus] = useState<string>("Normal");
  const [markdownValue, setMarkdownValue] = useState<number>(0);
  const [scannedInput, setScannedInput] = useState<string | null>(null);
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState<string>("");

  const handleBarcodeScan = async (input: string) => {
    setScannedInput(input);
    setProductDetails(null);
    setError(null);

    if (!token) {
      setError("Authentication token is missing.");
      return;
    }

    try {
      let product: ProductDetails | null = null;

      // Check if input is likely a SKU (8 or fewer characters) or barcode (more than 8 characters)
      const isSkuSearch = input.length <= 8;

      // Ensure token is undefined if it's null to match apiService expectations
      const apiToken = token || undefined;

      if (isSkuSearch) {
        // Search by SKU first
        product = await apiService.get<ProductDetails>(
          `/products/by-sku/${input}`,
          apiToken,
        );
      } else {
        // Search by barcode
        product = await apiService.get<ProductDetails>(
          `/products/by-barcode/${input}`,
          apiToken,
        );
      }

      // If not found by the primary method, try the alternative
      if (!product) {
        if (isSkuSearch) {
          // Try searching by barcode if SKU search failed
          product = await apiService.get<ProductDetails>(
            `/products/by-barcode/${input}`,
            apiToken,
          );
        } else {
          // Try searching by SKU if barcode search failed
          product = await apiService.get<ProductDetails>(
            `/products/by-sku/${input}`,
            apiToken,
          );
        }
      }

      if (!product) {
        setError("Product not found for this SKU or Barcode.");
        return;
      }

      setProductDetails(product);
      setCostPrice(product.cost_price);
    } catch (err: any) {
      if (err.message.includes("404")) {
        setError("Product not found for this SKU or Barcode.");
      } else {
        setError(
          err.message || "An error occurred while searching for the product.",
        );
      }
    }
  };

  const handleSearch = async () => {
    setError(null);

    if (!token) {
      setError("Authentication token is missing.");
      return;
    }

    if (!searchInput.trim()) {
      setError("Please enter a SKU or Barcode to search");
      return;
    }

    try {
      let product: ProductDetails | null = null;

      // Check if input is likely a SKU (8 or fewer characters) or barcode (more than 8 characters)
      const isSkuSearch = searchInput.length <= 8;

      // Ensure token is undefined if it's null to match apiService expectations
      const apiToken = token || undefined;

      if (isSkuSearch) {
        // Search by SKU first
        product = await apiService.get<ProductDetails>(
          `/products/by-sku/${searchInput}`,
          apiToken,
        );
      } else {
        // Search by barcode
        product = await apiService.get<ProductDetails>(
          `/products/by-barcode/${searchInput}`,
          apiToken,
        );
      }

      // If not found by the primary method, try the alternative
      if (!product) {
        if (isSkuSearch) {
          // Try searching by barcode if SKU search failed
          product = await apiService.get<ProductDetails>(
            `/products/by-barcode/${searchInput}`,
            apiToken,
          );
        } else {
          // Try searching by SKU if barcode search failed
          product = await apiService.get<ProductDetails>(
            `/products/by-sku/${searchInput}`,
            apiToken,
          );
        }
      }

      if (!product) {
        setError("Product not found for this SKU or Barcode.");
        return;
      }

      setProductDetails(product);
      setCostPrice(product.cost_price);
      setScannedInput(searchInput);
    } catch (err: any) {
      if (err.message.includes("404")) {
        setError("Product not found for this SKU or Barcode.");
      } else {
        setError(
          err.message || "An error occurred while searching for the product.",
        );
      }
    }
  };

  const calculateMarkdown = () => {
    if (!costPrice || !expiryDate) {
      setMarkdownStatus("Invalid Input");
      setMarkdownValue(0);
      return;
    }

    const today = new Date();
    const expiry = new Date(expiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let status = "Normal";
    let value = 0;

    if (diffDays <= 0) {
      status = "Expired";
      value = costPrice; // Expired items have the original cost price
    } else if (diffDays <= 30) {
      // Within 1 month from expiry: cost price - 20% (Markdown 3)
      status = "Markdown 3";
      value = costPrice * 0.8; // 20% markdown
    } else if (diffDays <= 60) {
      // Within 2 months from expiry: cost price (Markdown 2)
      status = "Markdown 2";
      value = costPrice; // No markdown
    } else if (diffDays <= 90) {
      // Within 3 months from expiry: cost price + 20% (Markdown 1)
      status = "Markdown 1";
      value = costPrice * 1.2; // +20% markup
    }

    setMarkdownStatus(status);
    setMarkdownValue(value);
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="text-center">Markdown Calculator</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <Scanner onScan={handleBarcodeScan} />
          </div>

          {productDetails && (
            <div className="mt-4 p-4 border rounded-md bg-gray-50">
              <p className="font-semibold">Scanned Product:</p>
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
            </div>
          )}

          <div className="grid gap-4 mt-4">
            <div>
              <Label htmlFor="costPrice">Cost Price</Label>
              <Input
                id="costPrice"
                type="number"
                value={costPrice}
                onChange={(e) => setCostPrice(parseFloat(e.target.value))}
                disabled={!!productDetails} // Disable if product details are loaded from scan
              />
            </div>
            <div>
              <Label htmlFor="expiryDate">Expiry Date</Label>
              <Input
                id="expiryDate"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
            <Button onClick={calculateMarkdown}>Calculate Markdown</Button>
            <div className="mt-4 p-4 border rounded-md bg-gray-50">
              <p>
                <strong>Status:</strong> {markdownStatus}
              </p>
              <p>
                <strong>Markdown Value:</strong> ${markdownValue.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
