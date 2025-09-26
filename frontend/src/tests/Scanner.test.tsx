import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Scanner } from "../components/Scanner";
import "@testing-library/jest-dom";

describe("Scanner", () => {
  it("renders the scanner input and button", () => {
    render(<Scanner onScan={jest.fn()} />);
    expect(
      screen.getByPlaceholderText(/Enter barcode manually/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Scan/i })).toBeInTheDocument();
  });

  it("calls onScan with the entered barcode when button is clicked", () => {
    const mockOnScan = jest.fn();
    render(<Scanner onScan={mockOnScan} />);

    fireEvent.change(screen.getByPlaceholderText(/Enter barcode manually/i), {
      target: { value: "12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Scan/i }));

    expect(mockOnScan).toHaveBeenCalledWith("12345");
    expect(screen.getByPlaceholderText(/Enter barcode manually/i)).toHaveValue(
      "",
    ); // Input should be cleared
  });

  it("calls onScan with the entered barcode when Enter key is pressed", () => {
    const mockOnScan = jest.fn();
    render(<Scanner onScan={mockOnScan} />);

    fireEvent.change(screen.getByPlaceholderText(/Enter barcode manually/i), {
      target: { value: "67890" },
    });
    fireEvent.keyPress(screen.getByPlaceholderText(/Enter barcode manually/i), {
      key: "Enter",
      code: 13,
      charCode: 13,
    });

    expect(mockOnScan).toHaveBeenCalledWith("67890");
    expect(screen.getByPlaceholderText(/Enter barcode manually/i)).toHaveValue(
      "",
    ); // Input should be cleared
  });

  it("does not call onScan if barcode is empty", () => {
    const mockOnScan = jest.fn();
    render(<Scanner onScan={mockOnScan} />);

    fireEvent.click(screen.getByRole("button", { name: /Scan/i }));
    expect(mockOnScan).not.toHaveBeenCalled();
  });
});
