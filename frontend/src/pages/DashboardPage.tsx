import React, { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { apiService } from "../lib/api.service";

interface DashboardPageProps {
  token: string | null;
}

interface DashboardData {
  totalProducts: number;
  expiringSoon: number;
  markdownItems: number;
  recentActivity: {
    id: number;
    description: string;
    timestamp: string;
  }[];
}

export function DashboardPage({ token }: DashboardPageProps) {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      if (!token) {
        setError("Authentication token is missing.");
        setLoading(false);
        return;
      }

      try {
        const data = await apiService.get<DashboardData>("/dashboard", token);
        setDashboardData(data);
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

    fetchDashboardData();
  }, [token]);

  if (loading) {
    return (
      <div className="container mx-auto p-4 text-center">
        Loading dashboard...
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
    <div className="container mx-auto p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Total Products</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{dashboardData?.totalProducts}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expiring Soon</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-orange-500">
            {dashboardData?.expiringSoon}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Markdown Items</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold text-red-500">
            {dashboardData?.markdownItems}
          </p>
        </CardContent>
      </Card>

      <Card className="md:col-span-2 lg:col-span-3">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ul>
            {dashboardData?.recentActivity.map((activity) => (
              <li
                key={activity.id}
                className="mb-2 pb-2 border-b last:border-b-0"
              >
                <p className="text-sm">{activity.description}</p>
                <p className="text-xs text-gray-500">{activity.timestamp}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
