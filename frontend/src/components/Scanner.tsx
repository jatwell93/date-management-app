import React, { useState } from "react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";

interface ScannerProps {
  onScan: (barcode: string) => void;
}

export function Scanner({ onScan }: ScannerProps) {
  const [barcode, setBarcode] = useState("");

  const handleScan = () => {
    if (barcode.trim()) {
      onScan(barcode.trim());
      setBarcode("");
    }
  };

  return (
    <div className="flex flex-col items-center space-y-4 p-4">
      <h2 className="text-xl font-semibold">Scan Barcode</h2>
      <Input
        type="text"
        placeholder="Enter barcode manually"
        value={barcode}
        onChange={(e) => setBarcode(e.target.value)}
        onKeyPress={(e) => {
          if (e.key === "Enter") {
            handleScan();
          }
        }}
        className="w-full max-w-sm"
      />
      <Button onClick={handleScan} className="w-full max-w-sm">
        Scan
      </Button>
    </div>
  );
}
