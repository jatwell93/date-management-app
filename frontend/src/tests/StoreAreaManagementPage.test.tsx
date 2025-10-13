import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor as _waitFor,
} from "@testing-library/react";
import { StoreAreaManagementPage } from "../pages/StoreAreaManagementPage";
import "@testing-library/jest-dom";

// Mock fetch API
global.fetch = jest.fn((url: RequestInfo | URL, options) => {
  const urlString = url.toString();
  if (urlString.includes("/store-areas")) {
    if (options?.method === "POST") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ id: 3, name: "New Area", last_checked: null }),
      } as Response);
    } else if (options?.method === "PUT") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ message: "Store area updated successfully!" }),
      } as Response);
    } else if (options?.method === "DELETE") {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ message: "Store area deleted successfully!" }),
      } as Response);
    } else {
      // GET request
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 1, name: "Aisle 1", last_checked: "2025-09-20T10:00:00Z" },
            { id: 2, name: "Aisle 2", last_checked: null },
          ]),
      } as Response);
    }
  }
  return Promise.reject(new Error("Unhandled fetch request"));
});

describe("StoreAreaManagementPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the store area management page and fetches areas", async () => {
    render(<StoreAreaManagementPage token="mock_token" />);

    expect(screen.getByText(/Store Area Management/i)).toBeInTheDocument();

    expect(await screen.findByText(/Aisle 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Aisle 2/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/store-areas",
      expect.objectContaining({
        headers: { Authorization: "Bearer mock_token" },
      }),
    );
  });

  it("adds a new store area", async () => {
    render(<StoreAreaManagementPage token="mock_token" />);

    await screen.findByText(/Aisle 1/i);

    fireEvent.change(screen.getByPlaceholderText(/New Area Name/i), {
      target: { value: "New Area" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Area/i }));

    expect(
      await screen.findByText(/Store area added successfully!/i),
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/store-areas",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "New Area" }),
      }),
    );
  });

  it("edits an existing store area", async () => {
    render(<StoreAreaManagementPage token="mock_token" />);

    await screen.findByText(/Aisle 1/i);

    fireEvent.click(screen.getAllByRole("button", { name: /Edit/i })[0]); // Click edit for Aisle 1

    const editInput = screen.getByLabelText(/Name/i);
    fireEvent.change(editInput, { target: { value: "Updated Aisle 1" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    expect(
      await screen.findByText(/Store area updated successfully!/i),
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/store-areas/1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "Updated Aisle 1" }),
      }),
    );
  });

  it("deletes a store area", async () => {
    window.confirm = jest.fn(() => true); // Mock window.confirm

    render(<StoreAreaManagementPage token="mock_token" />);

    await screen.findByText(/Aisle 1/i);

    fireEvent.click(screen.getAllByRole("button", { name: /Delete/i })[0]); // Click delete for Aisle 1

    expect(
      await screen.findByText(/Store area deleted successfully!/i),
    ).toBeInTheDocument();
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/store-areas/1",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });
});
