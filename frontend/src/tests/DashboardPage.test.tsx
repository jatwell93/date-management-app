import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { DashboardPage } from "../pages/DashboardPage";
import "@testing-library/jest-dom";

// Mock fetch API
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        totalProducts: 100,
        expiringSoon: 10,
        markdownItems: 5,
        recentActivity: [
          {
            id: 1,
            description: "Activity 1",
            timestamp: "2025-09-24T10:00:00Z",
          },
        ],
      }),
  } as Response),
);

describe("DashboardPage", () => {
  it("renders dashboard data on successful fetch", async () => {
    render(<DashboardPage token="mock_token" />);

    expect(screen.getByText(/Loading dashboard.../i)).toBeInTheDocument();

    expect(await screen.findByText(/Total Products/i)).toBeInTheDocument();
    expect(screen.getByText(/100/i)).toBeInTheDocument();
    expect(screen.getByText(/Expiring Soon/i)).toBeInTheDocument();
    expect(screen.getByText(/10/i)).toBeInTheDocument();
    expect(screen.getByText(/Markdown Items/i)).toBeInTheDocument();
    expect(screen.getByText(/5/i)).toBeInTheDocument();
    expect(screen.getByText(/Recent Activity/i)).toBeInTheDocument();
    expect(screen.getByText(/Activity 1/i)).toBeInTheDocument();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/dashboard",
      expect.objectContaining({
        headers: { Authorization: "Bearer mock_token" },
      }),
    );
  });

  it("displays an error message if token is missing", async () => {
    render(<DashboardPage token={null} />);

    await waitFor(() => {
      expect(
        screen.getByText(/Error: Authentication token is missing./i),
      ).toBeInTheDocument();
    });
  });

  it("displays an error message on failed data fetch", async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ message: "Failed to load data" }),
      } as Response),
    );

    render(<DashboardPage token="mock_token" />);

    await waitFor(() => {
      expect(
        screen.getByText(/Error: Failed to load data/i),
      ).toBeInTheDocument();
    });
  });
});
