import React, { useState } from "react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";

interface MarkdownCalculation {
  expiryDate: string;
  daysToExpiry: number;
  markdownPercentage: number;
  markdownPrice: number;
}

interface ScannerProps {
  onScan: (barcode: string) => void;
  markdownCalculations?: MarkdownCalculation[] | null;
}

export function Scanner({ onScan, markdownCalculations }: ScannerProps) {
  const [input, setInput] = useState("");

  const handleScan = () => {
    if (input.trim()) {
      onScan(input.trim());
      setInput("");
    }
  };

  // Function to get markdown status text based on markdown percentage
  const getMarkdownStatus = (markdownPercentage: number) => {
    if (markdownPercentage === -20) return "Markdown 3 (20% OFF)";
    if (markdownPercentage === 0) return "Original Price";
    if (markdownPercentage === 20) return "Markdown 1 (+20%)";
    return "Normal";
  };

  return (
    <div className="flex flex-col items-center space-y-4 p-4">
      <h2 className="text-xl font-semibold text-foreground">Scan/Enter Product ID</h2>
      <Input
        type="text"
        placeholder="Enter barcode or SKU"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={(e) => {
          if (e.key === "Enter") {
            handleScan();
          }
        }}
        className="w-full max-w-sm border-input bg-background text-foreground"
      />
      <Button 
        onClick={handleScan} 
        className="w-full max-w-sm bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        Search
      </Button>
      
      {/* Display markdown calculations if available */}
      {markdownCalculations && markdownCalculations.length > 0 && (
        <div className="w-full max-w-sm">
          <h3 className="text-lg font-semibold mb-2 text-foreground">Markdown Calculations</h3>
          <div className="space-y-2">
            {markdownCalculations.map((calc, index) => (
              <div key={index} className="p-3 border rounded-md bg-muted">
                <p className="font-medium text-foreground">Expiry: {new Date(calc.expiryDate).toLocaleDateString()}</p>
                <p className="text-muted-foreground">{calc.daysToExpiry} days to expiry</p>
                <p className={calc.markdownPercentage < 0 ? "text-inventory-error-500 font-semibold" : 
                           calc.markdownPercentage > 0 ? "text-inventory-success-500 font-semibold" : 
                           "text-inventory-warning-500 font-semibold"}>
                  {getMarkdownStatus(calc.markdownPercentage)}: ${calc.markdownPrice.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
