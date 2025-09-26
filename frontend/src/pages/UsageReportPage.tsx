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

interface UsageReportPageProps {
  token: string | null;
}

interface UsageData {
  user: string;
  scans: number;
  markdowns: number;
}

export function UsageReportPage({ token }: UsageReportPageProps) {
  const [usageData, setUsageData] = useState<UsageData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUsageData = async () => {
      if (!token) {
        setError("Authentication token is missing.");
        setLoading(false);
        return;
      }

      try {
        const response = await fetch("http://localhost:3001/reports/usage", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message || "Failed to load usage report data",
          );
        }

        const data = await response.json();
        setUsageData(data);
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

    fetchUsageData();
  }, [token]);

  if (loading) {
    return (
      <div className="container mx-auto p-4 text-center">
        Loading usage report...
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
          <CardTitle className="text-center">User Usage Report</CardTitle>
        </CardHeader>
        <CardContent>
          {usageData && usageData.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Scans</TableHead>
                  <TableHead>Markdowns</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usageData.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell>{row.user}</TableCell>
                    <TableCell>{row.scans}</TableCell>
                    <TableCell>{row.markdowns}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center">No usage report data available.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
