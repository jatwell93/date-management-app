import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { Scanner } from "./Scanner"; // Import the Scanner component

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
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [productDetails, setProductDetails] = useState<ProductDetails | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const handleBarcodeScan = async (barcode: string) => {
    setScannedBarcode(barcode);
    setProductDetails(null);
    setError(null);

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
        setError("Product not found for this barcode.");
        return;
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to fetch product details");
      }

      const product = await response.json();
      setProductDetails(product);
      setCostPrice(product.cost_price);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
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
      value = costPrice; // 100% markdown
    } else if (diffDays <= 7) {
      status = "Markdown 3";
      value = costPrice * 0.75; // 75% markdown
    } else if (diffDays <= 15) {
      status = "Markdown 2";
      value = costPrice * 0.5; // 50% markdown
    } else if (diffDays <= 30) {
      status = "Markdown 1";
      value = costPrice * 0.25; // 25% markdown
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
        <Scanner onScan={handleBarcodeScan} />
        {error && (
          <p className="text-red-500 text-sm text-center mt-4">
            Error: {error}
          </p>
        )}
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
              <strong>Cost Price:</strong> ${productDetails.cost_price?.toFixed(2)}
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
      </CardContent>
    </Card>
  );
}
