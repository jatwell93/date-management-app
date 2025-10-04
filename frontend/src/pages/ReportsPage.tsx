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

interface ReportsPageProps {
  token: string | null;
}

interface MonthlyExpiryReportItem {
  month: string;
  total_expiring: number;
  expired_count: number;
  markdown1_count: number;
  markdown2_count: number;
  markdown3_count: number;
  total_markdown: number;
  latest_expiry_date: string;
}

export function ReportsPage({ token }: ReportsPageProps) {
  const [reportData, setReportData] = useState<
    MonthlyExpiryReportItem[] | null
  >(null);
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
        const response = await fetch("http://localhost:3001/reports/expiry", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message || "Failed to load monthly expiry report",
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
        Loading reports...
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
          <CardTitle className="text-center">Monthly Expiry Report</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center mb-4">
            <a 
              href="/detailed-expiry-report" 
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
            >
              View Detailed Expiry Report (Next 90 Days)
            </a>
          </div>
          {reportData && reportData.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Total Expiring</TableHead>
                  <TableHead>Expired Items</TableHead>
                  <TableHead>Markdown 1</TableHead>
                  <TableHead>Markdown 2</TableHead>
                  <TableHead>Markdown 3</TableHead>
                  <TableHead>Total Markdown</TableHead>
                  <TableHead>Latest Expiry</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportData.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell>{row.month}</TableCell>
                    <TableCell>{row.total_expiring}</TableCell>
                    <TableCell>{row.expired_count}</TableCell>
                    <TableCell>{row.markdown1_count}</TableCell>
                    <TableCell>{row.markdown2_count}</TableCell>
                    <TableCell>{row.markdown3_count}</TableCell>
                    <TableCell>{row.total_markdown}</TableCell>
                    <TableCell>{row.latest_expiry_date}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center">No report data available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
