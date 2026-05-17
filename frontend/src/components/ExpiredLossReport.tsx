import React, { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { getExpiredLossesReport } from '../services/expiredItemService';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

interface ExpiredLossReportProps {
  token: string | null;
}

const ExpiredLossReport: React.FC<ExpiredLossReportProps> = ({ token }) => {
  const [lossesBySKU, setLossesBySKU] = useState<
    Array<{ sku: string; productName: string; totalLoss: number }>
  >([]);
  const [lossesByStoreArea, setLossesByStoreArea] = useState<
    Array<{ locationName: string; totalLoss: number }>
  >([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Authentication token not found');
      return;
    }

    const fetchExpiredLosses = async () => {
      try {
        setLoading(true);
        const data = await getExpiredLossesReport(token);
        setLossesBySKU(data.lossesBySKU);
        setLossesByStoreArea(data.lossesByStoreArea);
      } catch (err) {
        setError('Failed to fetch expired losses report');
        if (err instanceof Error) {
          Sentry.captureException(err, {
            tags: { feature: 'expired-loss-report' },
          });
        } else {
          Sentry.captureMessage('Failed to fetch expired losses report', {
            level: 'error',
            tags: { feature: 'expired-loss-report' },
          });
        }
      } finally {
        setLoading(false);
      }
    };

    fetchExpiredLosses();
  }, [token]);

  if (loading) {
    return <div className="text-center py-10">Loading expired losses report...</div>;
  }

  if (error) {
    return <div className="text-center py-10 text-semantic-critical">{error}</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h2 className="text-2xl font-bold font-heading mb-6">Expired Item Loss Report</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Losses by SKU */}
        <div className="border rounded-lg shadow-sm overflow-hidden">
          <h3 className="text-xl font-semibold font-heading p-4 bg-muted">Financial Loss by SKU</h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
                    SKU
                  </TableHead>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
                    Product Name
                  </TableHead>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
                    Total Loss
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lossesBySKU.map((item, index) => (
                  <TableRow key={index} className="hover:bg-muted/50">
                    <TableCell className="whitespace-nowrap text-sm text-foreground">
                      {item.sku}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm font-medium text-foreground">
                      {item.productName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-foreground">
                      ${item.totalLoss.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Losses by Store Area */}
        <div className="border rounded-lg shadow-sm overflow-hidden">
          <h3 className="text-xl font-semibold font-heading p-4 bg-muted">
            Financial Loss by Store Area
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
                    Location Name
                  </TableHead>
                  <TableHead className="text-left text-xs font-semibold font-eyebrow text-muted-foreground uppercase tracking-wider">
                    Total Loss
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lossesByStoreArea.map((item, index) => (
                  <TableRow key={index} className="hover:bg-muted/50">
                    <TableCell className="whitespace-nowrap text-sm font-medium text-foreground">
                      {item.locationName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-foreground">
                      ${item.totalLoss.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExpiredLossReport;
