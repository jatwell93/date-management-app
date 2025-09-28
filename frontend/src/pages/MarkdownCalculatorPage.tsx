import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { isWithinMarkdownPeriod, calculateMarkdownPrice } from "../lib/utils";

export function MarkdownCalculatorPage() {
  const [costPrice, setCostPrice] = useState<string>("");
  const [expiryDate, setExpiryDate] = useState<string>("");
  const [calculatedPrice, setCalculatedPrice] = useState<number | null>(null);
  const [markdownPercentage, setMarkdownPercentage] = useState<number | null>(null);
  const [currentDate, setCurrentDate] = useState<string>(new Date().toISOString().split('T')[0]);

  const handleCalculate = () => {
    if (!costPrice || !expiryDate) {
      alert("Please enter both cost price and expiry date");
      return;
    }

    const cost = parseFloat(costPrice);
    if (isNaN(cost) || cost <= 0) {
      alert("Please enter a valid cost price");
      return;
    }

    // Calculate days between current date and expiry date
    const currentDateObj = new Date(currentDate);
    const expiryDateObj = new Date(expiryDate);
    
    // Calculate the difference in days
    const timeDiff = expiryDateObj.getTime() - currentDateObj.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    // Determine markdown percentage based on days to expiry
    let percentage: number;
    if (daysDiff < 0) {
      // Expired item
      percentage = 0;
      alert("This item is already expired!");
    } else if (daysDiff <= 30) {
      // Within 1 month - 20% discount (Markdown 3)
      percentage = -20;
    } else if (daysDiff <= 60) {
      // Within 2 months - original price (Markdown 2)
      percentage = 0;
    } else if (daysDiff <= 90) {
      // Within 3 months - 20% markup (Markdown 1)
      percentage = 20;
    } else {
      // More than 3 months - normal price
      percentage = 0;
    }

    const calculated = calculateMarkdownPrice(cost, percentage);
    
    setCalculatedPrice(calculated);
    setMarkdownPercentage(percentage);
  };

  const handleReset = () => {
    setCostPrice("");
    setExpiryDate("");
    setCalculatedPrice(null);
    setMarkdownPercentage(null);
  };

  return (
    <div className="container mx-auto p-4">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-center">Markdown Calculator</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="costPrice">Cost Price ($)</Label>
              <Input
                id="costPrice"
                type="number"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="Enter cost price"
                className="mt-1"
                step="0.01"
                min="0"
              />
            </div>

            <div>
              <Label htmlFor="currentDate">Current Date</Label>
              <Input
                id="currentDate"
                type="date"
                value={currentDate}
                onChange={(e) => setCurrentDate(e.target.value)}
                className="mt-1"
              />
            </div>

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

            <div className="flex space-x-2 pt-2">
              <Button onClick={handleCalculate} className="flex-1">
                Calculate
              </Button>
              <Button onClick={handleReset} variant="outline" className="flex-1">
                Reset
              </Button>
            </div>

            {calculatedPrice !== null && markdownPercentage !== null && (
              <div className="mt-4 p-4 border rounded-md bg-gray-50">
                <h3 className="text-lg font-semibold mb-2">Calculation Results</h3>
                
                <div className="space-y-2">
                  <p><strong>Cost Price:</strong> ${parseFloat(costPrice).toFixed(2)}</p>
                  <p><strong>Days to Expiry:</strong> {
                    expiryDate ? 
                    Math.ceil((new Date(expiryDate).getTime() - new Date(currentDate).getTime()) / (1000 * 60 * 60 * 24))
                    : "N/A"
                  } days</p>
                  
                  <p className={
                    markdownPercentage < 0 ? "text-red-500 font-semibold" : 
                    markdownPercentage > 0 ? "text-green-500 font-semibold" : 
                    "text-blue-500 font-semibold"
                  }>
                    <strong>Markdown:</strong> {markdownPercentage > 0 ? '+' : ''}{markdownPercentage}%
                  </p>
                  
                  <p className="text-lg font-bold">
                    <strong>Calculated Price:</strong> ${calculatedPrice.toFixed(2)}
                  </p>
                  
                  <div className="mt-2 p-2 bg-gray-100 rounded">
                    {markdownPercentage === 20 && (
                      <p className="text-green-600">Markdown 1: Item is within 3 months of expiry. 20% markup applied.</p>
                    )}
                    {markdownPercentage === 0 && (
                      <p className="text-blue-600">
                        {Math.ceil((new Date(expiryDate).getTime() - new Date(currentDate).getTime()) / (1000 * 60 * 60 * 24)) <= 90 && 
                         Math.ceil((new Date(expiryDate).getTime() - new Date(currentDate).getTime()) / (1000 * 60 * 60 * 24)) > 60 ? 
                         "Markdown 2: Item is within 2 months of expiry. Original price maintained." : 
                         "Normal: Item is more than 3 months from expiry. Original price maintained."}
                      </p>
                    )}
                    {markdownPercentage === -20 && (
                      <p className="text-red-600">Markdown 3: Item is within 1 month of expiry. 20% discount applied.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}