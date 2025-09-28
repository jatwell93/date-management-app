import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UserManagementPage } from "../pages/UserManagementPage";

// Mock the fetch API
(global.window as any).fetch = jest.fn() as any;

// Default mock implementation for fetching users
(global.fetch as jest.Mock).mockImplementation(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve([
        { id: 1, role: "Manager" },
        { id: 2, role: "Team Member" },
      ]),
  }),
);

describe("UserManagementPage", () => {
  const mockToken = "mock-manager-token";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders user management page and fetches users", async () => {
    render(<UserManagementPage token={mockToken} />);

    expect(
      screen.getByText(/User Management \(Managers Only\)/i),
    ).toBeInTheDocument();

    expect(
      await screen.findByText(/ID: 1, Role: Manager/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ID: 2, Role: Team Member/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/users",
      expect.objectContaining({
        headers: { Authorization: `Bearer ${mockToken}` },
      }),
    );
  });

  test("creates a new user", async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ message: "User created successfully!" }),
      }),
    ); // Mock for create user
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 1, role: "Manager" },
            { id: 2, role: "Team Member" },
            { id: 3, role: "Team Member" },
          ]),
      }),
    ); // Mock for re-fetching users

    render(<UserManagementPage token={mockToken} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1)); // Initial fetch

    fireEvent.change(screen.getByPlaceholderText(/Enter user PIN/i), {
      target: { value: "5678" },
    });
    fireEvent.mouseDown(screen.getByText(/Select a role/i));
    fireEvent.click(screen.getByText(/Team Member/i));
    fireEvent.click(screen.getByRole("button", { name: /Create User/i }));

    expect(
      await screen.findByText(/User created successfully!/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ID: 3, Role: Team Member/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(3); // Initial fetch, create, re-fetch
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/users",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ pin: "5678", role: "Team Member" }),
      }),
    );
  });

  test("updates an existing user role", async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ message: "User updated successfully!" }),
      }),
    ); // Mock for update user
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 1, role: "Manager" },
            { id: 2, role: "Manager" }, // Updated role
          ]),
      }),
    ); // Mock for re-fetching users

    render(<UserManagementPage token={mockToken} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1)); // Initial fetch

    fireEvent.mouseDown(screen.getByLabelText(/Select User to Edit/i));
    fireEvent.click(screen.getByText(/ID: 2, Role: Team Member/i));

    fireEvent.mouseDown(screen.getAllByText(/Select a role/i)[1]); // Select for edit form
    fireEvent.click(screen.getAllByText(/Manager/i)[1]);

    fireEvent.click(screen.getByRole("button", { name: /Update User/i }));

    expect(
      await screen.findByText(/User updated successfully!/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ID: 2, Role: Manager/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(3); // Initial fetch, update, re-fetch
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/users/2",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ role: "Manager" }),
      }),
    );
  });

  test("deletes a user", async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ message: "User deleted successfully!" }),
      }),
    ); // Mock for delete user
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ id: 1, role: "Manager" }]),
      }),
    ); // Mock for re-fetching users

    render(<UserManagementPage token={mockToken} />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1)); // Initial fetch

    fireEvent.mouseDown(screen.getByLabelText(/Select User to Delete/i));
    fireEvent.click(screen.getByText(/ID: 2, Role: Team Member/i));

    window.confirm = jest.fn(() => true); // Mock window.confirm
    fireEvent.click(screen.getByRole("button", { name: /Delete User/i }));

    expect(
      await screen.findByText(/User deleted successfully!/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/ID: 2, Role: Team Member/i),
    ).not.toBeInTheDocument();
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(3); // Initial fetch, delete, re-fetch
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/users/2",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });
});
