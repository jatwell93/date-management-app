import React, { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { getExpiredLossesReport } from '../services/expiredItemService';
import { useFreshApiToken } from '../hooks/useFreshApiToken';
import { withOccurrenceKeys } from '../utils/listKeys';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});

interface ExpiredLossReportProps {
  token: string | null;
}

const ExpiredLossReport: React.FC<ExpiredLossReportProps> = ({ token }) => {
  const getFreshApiToken = useFreshApiToken(token);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: guard state when the auth prerequisite is absent
      setError('Authentication token not found');
      setLoading(false);
      return;
    }

    // Ignore results that land after unmount or a token change.
    let active = true;

    const fetchExpiredLosses = async () => {
      try {
        setLoading(true);
        const authToken = await getFreshApiToken('expired-loss-report');
        const data = await getExpiredLossesReport(authToken || null);
        if (!active) return;
        setLossesBySKU(data.lossesBySKU);
        setLossesByStoreArea(data.lossesByStoreArea);
      } catch (err) {
        if (!active) return;
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
        if (active) setLoading(false);
      }
    };

    fetchExpiredLosses();
    return () => {
      active = false;
    };
  }, [token, getFreshApiToken]);

  if (loading) {
    return (
      <div className="text-center py-10" role="status">
        Loading expired losses report…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 text-semantic-critical" role="alert">
        {error}
      </div>
    );
  }

  return (
    <section className="py-8" aria-labelledby="expired-loss-report-heading">
      <h2 id="expired-loss-report-heading" className="text-2xl font-semibold font-heading mb-6">
        Expired Item Loss Report
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Losses by SKU */}
        <div className="border rounded-lg bg-semantic-surface-1 overflow-hidden">
          <h3 className="text-xl font-semibold font-heading p-4 bg-semantic-surface-2">
            Financial Loss by SKU
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left text-sm font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    SKU
                  </TableHead>
                  <TableHead className="text-left text-sm font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    Product Name
                  </TableHead>
                  <TableHead className="text-right text-sm font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    Total Loss
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lossesBySKU.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-6 text-center text-sm text-semantic-text-secondary"
                    >
                      No SKU losses recorded yet.
                    </TableCell>
                  </TableRow>
                )}
                {lossesBySKU.map((item) => (
                  <TableRow key={item.sku} className="hover:bg-semantic-surface-2/50">
                    <TableCell className="whitespace-nowrap text-sm text-semantic-text-primary">
                      {item.sku}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm font-medium text-semantic-text-primary">
                      {item.productName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm tabular-nums text-semantic-text-primary">
                      {currencyFormatter.format(item.totalLoss)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Losses by Store Area */}
        <div className="border rounded-lg bg-semantic-surface-1 overflow-hidden">
          <h3 className="text-xl font-semibold font-heading p-4 bg-semantic-surface-2">
            Financial Loss by Store Area
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left text-sm font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    Location Name
                  </TableHead>
                  <TableHead className="text-right text-sm font-semibold font-eyebrow text-semantic-text-secondary uppercase tracking-wider">
                    Total Loss
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lossesByStoreArea.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={2}
                      className="py-6 text-center text-sm text-semantic-text-secondary"
                    >
                      No store area losses recorded yet.
                    </TableCell>
                  </TableRow>
                )}
                {withOccurrenceKeys(lossesByStoreArea, (a) => a.locationName).map(
                  ({ item, key }) => (
                    <TableRow key={key} className="hover:bg-semantic-surface-2/50">
                      <TableCell className="whitespace-nowrap text-sm font-medium text-semantic-text-primary">
                        {item.locationName}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums text-semantic-text-primary">
                        {currencyFormatter.format(item.totalLoss)}
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ExpiredLossReport;
