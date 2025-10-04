import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

interface DetailedExpiryReportPageProps {
  token: string | null;
}

interface DetailedExpiryReportItem {
  inventoryId: number;
  expiryDate: string; // Format: YYYY-MM-DD
  status: string;
  productId: number;
  productName: string;
  sku: string;
  locationId: number;
  locationName: string;
  subDepartment: string | null;
}

export function DetailedExpiryReportPage({ token }: DetailedExpiryReportPageProps) {
  const [reportData, setReportData] = useState<DetailedExpiryReportItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReportData = async () => {
      if (!token) {
        setError("Authentication token is missing.");
        setLoading(false);
        return;
      }

      try {
        const response = await fetch("http://localhost:3001/reports/expiry-details", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message || "Failed to load detailed expiry report",
          );
        }

        const data = await response.json();
        setReportData(data);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("An unknown error occurred");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchReportData();
  }, [token]);

  if (loading) {
    return (
      <div className="container mx-auto p-4 text-center">
        Loading detailed expiry report...
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 text-center text-red-500">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Detailed Expiry Report (Next 90 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {reportData && reportData.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Expiry Date</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Sub-Department</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.map((row) => (
                  <TableRow key={row.inventoryId}>
                    <TableCell>{new Date(row.expiryDate).toLocaleDateString()}</TableCell>
                    <TableCell>{row.productName}</TableCell>
                    <TableCell>{row.sku}</TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell>{row.locationName}</TableCell>
                    <TableCell>{row.subDepartment || 'N/A'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center">No expiry items found in the next 90 days.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}