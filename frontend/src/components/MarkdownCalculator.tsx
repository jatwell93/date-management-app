import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";

interface MarkdownCalculatorProps {
  costPrice: number;
  expiryDate: string; // YYYY-MM-DD format
}

export function MarkdownCalculator({
  costPrice,
  expiryDate,
}: MarkdownCalculatorProps) {
  const [markdownStatus, setMarkdownStatus] = useState<string>("Normal");
  const [markdownValue, setMarkdownValue] = useState<number>(0);

  const calculateMarkdown = () => {
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
        <div className="grid gap-4">
          <div>
            <Label htmlFor="costPrice">Cost Price</Label>
            <Input
              id="costPrice"
              type="number"
              value={costPrice.toFixed(2)}
              readOnly
            />
          </div>
          <div>
            <Label htmlFor="expiryDate">Expiry Date</Label>
            <Input id="expiryDate" type="date" value={expiryDate} readOnly />
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
