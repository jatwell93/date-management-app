import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginPage } from "../components/LoginPage";

// Mock the fetch API
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ token: "mock-auth-token-manager" }),
  }),
) as jest.Mock;

describe("LoginPage", () => {
  const mockOnLogin = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("renders login form", () => {
    render(<LoginPage onLogin={mockOnLogin} />);
    expect(screen.getByLabelText(/PIN/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Login/i })).toBeInTheDocument();
  });

  test("calls onLogin with token on successful login", async () => {
    render(<LoginPage onLogin={mockOnLogin} />);
    const pinInput = screen.getByLabelText(/PIN/i);
    const loginButton = screen.getByRole("button", { name: /Login/i });

    fireEvent.change(pinInput, { target: { value: "12345" } });
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(mockOnLogin).toHaveBeenCalledWith("mock-auth-token-manager");
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ pin: "12345" }),
      }),
    );
  });

  test("displays error message on failed login", async () => {
    global.fetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ message: "Invalid credentials" }),
      }),
    );

    render(<LoginPage onLogin={mockOnLogin} />);
    const pinInput = screen.getByLabelText(/PIN/i);
    const loginButton = screen.getByRole("button", { name: /Login/i });

    fireEvent.change(pinInput, { target: { value: "wrongpin" } });
    fireEvent.click(loginButton);

    expect(await screen.findByText(/Invalid credentials/i)).toBeInTheDocument();
    expect(mockOnLogin).not.toHaveBeenCalled();
  });
});
