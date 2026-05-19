import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { apiService } from '../lib/api.service';

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
  const [reportData, setReportData] = useState<MonthlyExpiryReportItem[] | null>(null);
  const [overallReportData, setOverallReportData] = useState<MonthlyExpiryReportItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [overallLoading, setOverallLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReportData = async () => {
      if (!token) {
        setError('Authentication token is missing.');
        setLoading(false);
        return;
      }

      try {
        const data = await apiService.get<MonthlyExpiryReportItem[]>('/reports/expiry', token);
        setReportData(data);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred');
        }
      } finally {
        setLoading(false);
      }
    };

    const fetchOverallReportData = async () => {
      if (!token) {
        setError('Authentication token is missing.');
        setOverallLoading(false);
        return;
      }

      try {
        const data = await apiService.get<MonthlyExpiryReportItem>(
          '/reports/expiry-overall',
          token,
        );
        setOverallReportData(data);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred');
        }
      } finally {
        setOverallLoading(false);
      }
    };

    fetchReportData();
    fetchOverallReportData();
  }, [token]);

  if (loading) {
    return <div className="container mx-auto p-4 text-center">Loading reports…</div>;
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 text-center text-semantic-critical">Error: {error}</div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-center">Overall Expiry Report</CardTitle>
        </CardHeader>
        <CardContent>
          {overallLoading ? (
            <div className="text-center">Loading overall report…</div>
          ) : overallReportData ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-semantic-secondary-muted p-4 rounded-lg text-center">
                <p className="text-2xl font-bold font-heading">
                  {overallReportData.total_expiring}
                </p>
                <p className="text-sm text-semantic-text-secondary">Total Items</p>
              </div>
              <div className="bg-semantic-critical-muted p-4 rounded-lg text-center">
                <p className="text-2xl font-bold font-heading text-semantic-critical">
                  {overallReportData.expired_count}
                </p>
                <p className="text-sm text-semantic-text-secondary">Expired Items</p>
              </div>
              <div className="bg-semantic-warning-muted p-4 rounded-lg text-center">
                <p className="text-2xl font-bold font-heading text-semantic-warning">
                  {overallReportData.total_markdown}
                </p>
                <p className="text-sm text-semantic-text-secondary">Markdown Items</p>
              </div>
              <div className="bg-semantic-success-muted p-4 rounded-lg text-center">
                <p className="text-2xl font-bold font-heading text-semantic-success">
                  {overallReportData.total_expiring -
                    overallReportData.expired_count -
                    overallReportData.total_markdown}
                </p>
                <p className="text-sm text-semantic-text-secondary">Active Items</p>
              </div>
            </div>
          ) : (
            <p className="text-center">No overall report data available.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-center">Monthly Expiry Report</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center mb-4">
            <a
              href="/detailed-expiry-report"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity mr-2"
            >
              View Detailed Expiry Report (Next 90 Days)
            </a>
            <a
              href="/expired-items"
              className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 transition-opacity"
            >
              View Expired Items
            </a>
          </div>
          {loading ? (
            <div className="text-center">Loading monthly report…</div>
          ) : reportData && reportData.length > 0 ? (
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
