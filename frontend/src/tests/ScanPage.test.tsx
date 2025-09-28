import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor as _waitFor,
} from "@testing-library/react";
import { ScanPage } from "../pages/ScanPage";
import "@testing-library/jest-dom";
import { offlineStorage } from "../lib/offline-storage";

// Mock fetch API
global.fetch = jest.fn((url: RequestInfo | URL) => {
  const urlString = url.toString();
  if (urlString.includes("/products?barcode=")) {
    if (urlString.includes("123")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 1,
            barcode: "123",
            name: "Test Product",
            sku: "TS1",
            cost_price: 10.0,
          }),
      } as Response);
    } else if (urlString.includes("non_existent")) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: "Product not found" }),
      } as Response);
    }
  } else if (urlString.includes("/products")) {
    // Mock for adding new product
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 2,
          barcode: "non_existent",
          name: "New Product",
          sku: "NP1",
          cost_price: 15.0,
        }),
    } as Response);
  } else if (urlString.includes("/inventory-items")) {
    // Mock for adding inventory item
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({ message: "Inventory item added successfully!" }),
    } as Response);
  } else if (urlString.includes("/store-areas")) {
    // Mock for fetching store areas
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve([
          { id: 1, name: "Aisle 1" },
          { id: 2, name: "Aisle 2" },
        ]),
    } as Response);
  }
  return Promise.reject(new Error("Unhandled fetch request"));
});

// Mock offlineStorage
jest.mock("../lib/offline-storage", () => ({
  offlineStorage: {
    setItem: jest.fn(),
    getItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
    keys: jest.fn(() => Promise.resolve([])),
  },
}));

describe("ScanPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default to online
    Object.defineProperty(navigator, "onLine", { writable: true, value: true });
  });

  it("renders the scan page and fetches product details on scan", async () => {
    render(<ScanPage token="mock_token" />);

    expect(screen.getByText(/Inventory Scan/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Enter barcode manually/i), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Scan/i }));

    expect(await screen.findByText(/Product Details:/i)).toBeInTheDocument();
    expect(screen.getByText(/Test Product/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/products?barcode=123",
      expect.objectContaining({
        headers: { Authorization: "Bearer mock_token" },
      }),
    );
  });

  it("displays an error message if token is missing", async () => {
    render(<ScanPage token={null} />);

    fireEvent.change(screen.getByPlaceholderText(/Enter barcode manually/i), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Scan/i }));

    expect(
      await screen.findByText(/Authentication token is missing./i),
    ).toBeInTheDocument();
  });

  it("displays new product form when product is not found", async () => {
    render(<ScanPage token="mock_token" />);

    fireEvent.change(screen.getByPlaceholderText(/Enter barcode manually/i), {
      target: { value: "non_existent" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Scan/i }));

    expect(
      await screen.findByText(/Product not found for barcode: non_existent/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add New Product/i }),
    ).toBeInTheDocument();
  });

  it("adds a new product and then shows inventory details form", async () => {
    render(<ScanPage token="mock_token" />);

    fireEvent.change(screen.getByPlaceholderText(/Enter barcode manually/i), {
      target: { value: "non_existent" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Scan/i }));

    expect(
      await screen.findByText(/Product not found for barcode: non_existent/i),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Enter product name/i), {
      target: { value: "New Product" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Enter SKU/i), {
      target: { value: "NP1" },
    });
    fireEvent.change(screen.getByPlaceholderText(/Enter cost price/i), {
      target: { value: "15.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add New Product/i }));

    expect(
      await screen.findByText(
        /New product added successfully! Now add inventory details./i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Product Details:/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/products",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          barcode: "non_existent",
          name: "New Product",
          sku: "NP1",
          cost_price: 15.0,
        }),
      }),
    );
  });

  it("submits inventory item successfully when online", async () => {
    render(<ScanPage token="mock_token" />);

    fireEvent.change(screen.getByPlaceholderText(/Enter barcode manually/i), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Scan/i }));

    expect(await screen.findByText(/Product Details:/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: "2026-12-31" },
    });
    fireEvent.mouseDown(screen.getByText(/Select a location/i));
    fireEvent.click(screen.getByText(/Aisle 1/i));
    fireEvent.click(screen.getByRole("button", { name: /Confirm & Save/i }));

    expect(
      await screen.findByText(/Inventory item added successfully!/i),
    ).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/inventory-items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          product_id: 1,
          expiry_date: "2026-12-31",
          location_id: 1,
        }),
      }),
    );
    expect(offlineStorage.setItem).not.toHaveBeenCalled();
  });

  it("saves inventory item to offline storage when offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: false,
    });
    render(<ScanPage token="mock_token" />);

    fireEvent.change(screen.getByPlaceholderText(/Enter barcode manually/i), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Scan/i }));

    expect(await screen.findByText(/Product Details:/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: "2026-12-31" },
    });
    fireEvent.mouseDown(screen.getByText(/Select a location/i));
    fireEvent.click(screen.getByText(/Aisle 1/i));
    fireEvent.click(screen.getByRole("button", { name: /Confirm & Save/i }));

    expect(
      await screen.findByText(
        /Offline: Inventory item saved for synchronization./i,
      ),
    ).toBeInTheDocument();
    expect(offlineStorage.setItem).toHaveBeenCalledTimes(1);
    expect(offlineStorage.setItem).toHaveBeenCalledWith(
      expect.stringMatching(/^pending-inventory-item-/),
      { product_id: 1, expiry_date: "2026-12-31", location_id: 1 },
    );
    expect(global.fetch).not.toHaveBeenCalledWith(
      "http://localhost:3001/inventory-items",
      expect.any(Object),
    );
  });
});
