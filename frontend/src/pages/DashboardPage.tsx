import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { apiService } from '../lib/api.service';

interface DashboardPageProps {
  token: string | null;
}

interface DashboardStats {
  totalProducts: number;
  totalInventoryItems: number;
  expiringItems: number;
  lowStockItems: number;
}

interface DashboardActivityEntry {
  id: number;
  description: string;
  timestamp: string;
}

// The Workers API (GET /api/dashboard) returns `{ stats: DashboardStats }`.
// Older versions of this page expected a flat object with
// `expiringSoon`/`markdownItems`/`recentActivity` — that shape is no longer
// produced by the backend and tried to call `.map` on an undefined
// `recentActivity`, which threw and left the user stuck on the generic
// ErrorBoundary fallback with nothing in the console.
interface DashboardResponse {
  stats: DashboardStats;
  recentActivity?: DashboardActivityEntry[];
}

export function DashboardPage({ token }: DashboardPageProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<DashboardActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!token) {
        setError('Authentication token is missing.');
        setLoading(false);
        return;
      }

      try {
        const data = await apiService.get<DashboardResponse>('/dashboard', token);
        setStats(data?.stats ?? null);
        setRecentActivity(Array.isArray(data?.recentActivity) ? data.recentActivity : []);
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

    fetchDashboardData();
  }, [token]);

  if (loading) {
    return <div className="container mx-auto p-4 text-center">Loading dashboard...</div>;
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 text-center text-semantic-critical">Error: {error}</div>
    );
  }

  return (
    <div className="container mx-auto p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Total Products</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold font-heading">{stats?.totalProducts ?? 0}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Inventory Items</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold font-heading">{stats?.totalInventoryItems ?? 0}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expiring Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold font-heading text-semantic-warning">
            {stats?.expiringItems ?? 0}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Low Stock</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold font-heading text-semantic-critical">
            {stats?.lowStockItems ?? 0}
          </p>
        </CardContent>
      </Card>

      <Card className="md:col-span-2 lg:col-span-3">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity yet.</p>
          ) : (
            <ul>
              {recentActivity.map((activity) => (
                <li key={activity.id} className="mb-2 pb-2 border-b last:border-b-0">
                  <p className="text-sm">{activity.description}</p>
                  <p className="text-xs text-semantic-text-tertiary">{activity.timestamp}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
