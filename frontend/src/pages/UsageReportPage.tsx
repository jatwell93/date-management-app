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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { semanticDataViz } from '../theme/semantic-tokens';

// Import Chart.js components
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
);

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

interface ItemsByUserReportItem {
  userId: number;
  userName: string;
  itemCount: number;
}

interface ItemsByDateReportItem {
  date: string; // YYYY-MM-DD
  itemCount: number;
}

export function UsageReportPage({ token }: UsageReportPageProps) {
  const [usageData, setUsageData] = useState<DailyUsageReportItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [itemsByUser, setItemsByUser] = useState<ItemsByUserReportItem[] | null>(null);
  const [itemsByDate, setItemsByDate] = useState<ItemsByDateReportItem[] | null>(null);
  const [chartsLoading, setChartsLoading] = useState(true);
  const [timeFrame, setTimeFrame] = useState('all-time');

  useEffect(() => {
    const fetchUsageData = async () => {
      if (!token) {
        setError('Authentication token is missing.');
        setLoading(false);
        return;
      }

      try {
        const data = await apiService.get<DailyUsageReportItem[]>('/reports/daily-usage', token);
        setUsageData(data);
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

    fetchUsageData();
  }, [token]);

  // Fetch chart data
  useEffect(() => {
    const fetchChartData = async () => {
      if (!token) {
        setError('Authentication token is missing.');
        setChartsLoading(false);
        return;
      }

      try {
        // Fetch both chart datasets concurrently
        const [itemsByUser, itemsByDate] = await Promise.all([
          apiService.get<ItemsByUserReportItem[]>(
            `/reports/items-by-user?timeFrame=${timeFrame}`,
            token,
          ),
          apiService.get<ItemsByDateReportItem[]>('/reports/items-by-date', token),
        ]);

        setItemsByUser(itemsByUser);
        setItemsByDate(itemsByDate);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred when fetching chart data');
        }
      } finally {
        setChartsLoading(false);
      }
    };

    fetchChartData();
  }, [token, timeFrame]);

  if (loading) {
    return <div className="container mx-auto p-4 text-center">Loading usage report...</div>;
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 text-center text-semantic-critical">Error: {error}</div>
    );
  }

  // Prepare chart data for Items by User
  const itemsByUserChartData = {
    labels: itemsByUser?.map((item) => `User ${item.userId}`) || [],
    datasets: [
      {
        label: 'Items Added',
        data: itemsByUser?.map((item) => item.itemCount) || [],
        backgroundColor: semanticDataViz.series4,
        borderColor: semanticDataViz.series4,
        borderWidth: 1,
      },
    ],
  };

  // Prepare chart data for Items by Date
  const itemsByDateChartData = {
    labels: itemsByDate?.map((item) => new Date(item.date).toLocaleDateString()) || [],
    datasets: [
      {
        label: 'Items Added',
        data: itemsByDate?.map((item) => item.itemCount) || [],
        fill: false,
        borderColor: semanticDataViz.series2,
        backgroundColor: semanticDataViz.series2,
        tension: 0.1,
      },
    ],
  };

  const barChartOptions = {
    responsive: true,
    plugins: {
      title: {
        display: true,
      },
      legend: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  const lineChartOptions = {
    responsive: true,
    plugins: {
      title: {
        display: true,
      },
      legend: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  return (
    <div className="container mx-auto p-4">
      {/* Chart Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-center">Items Added by User</CardTitle>
            <Select value={timeFrame} onValueChange={setTimeFrame}>
              <SelectTrigger className="w-[180px] mt-2">
                <SelectValue placeholder="Select time frame" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 Days</SelectItem>
                <SelectItem value="30">Last 30 Days</SelectItem>
                <SelectItem value="90">Last 90 Days</SelectItem>
                <SelectItem value="all-time">All-time</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {chartsLoading ? (
              <div className="text-center py-8">Loading chart data...</div>
            ) : itemsByUser && itemsByUser.length > 0 ? (
              <Bar
                data={itemsByUserChartData}
                options={{
                  ...barChartOptions,
                  plugins: {
                    ...barChartOptions.plugins,
                    title: {
                      display: true,
                      text: 'Top Users by Items Added',
                    },
                  },
                }}
              />
            ) : (
              <div className="text-center py-4 text-semantic-text-tertiary">
                No user data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">Items Added per Day</CardTitle>
          </CardHeader>
          <CardContent>
            {chartsLoading ? (
              <div className="text-center py-8">Loading chart data...</div>
            ) : itemsByDate && itemsByDate.length > 0 ? (
              <Line
                data={itemsByDateChartData}
                options={{
                  ...lineChartOptions,
                  plugins: {
                    ...lineChartOptions.plugins,
                    title: {
                      display: true,
                      text: 'Items Added Over Time',
                    },
                  },
                }}
              />
            ) : (
              <div className="text-center py-4 text-semantic-text-tertiary">
                No date data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Original Table Section */}
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
