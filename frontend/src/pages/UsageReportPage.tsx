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

interface DailyUsageReportItem {
  date: string; // YYYY-MM-DD
  user_id: number;
  user_role: string;
  creations: number;
  updates: number;
  deletions: number;
}

export function UsageReportPage({ token }: UsageReportPageProps) {
  const [usageData, setUsageData] = useState<DailyUsageReportItem[] | null>(null);
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
        const response = await fetch("http://localhost:3001/reports/daily-usage", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message || "Failed to load daily usage report data",
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
          <CardTitle className="text-center">Daily User Activity Report (Last 90 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          {usageData && usageData.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Creations</TableHead>
                  <TableHead>Updates</TableHead>
                  <TableHead>Deletions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usageData.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell>{new Date(row.date).toLocaleDateString()}</TableCell>
                    <TableCell>{row.user_id}</TableCell>
                    <TableCell>{row.user_role}</TableCell>
                    <TableCell>{row.creations}</TableCell>
                    <TableCell>{row.updates}</TableCell>
                    <TableCell>{row.deletions}</TableCell>
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
