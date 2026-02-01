import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Scanner } from '../components/Scanner';
import '@testing-library/jest-dom';

describe('Scanner', () => {
  it('renders the scanner input and button', () => {
    render(<Scanner onScan={jest.fn()} />);
    expect(screen.getByPlaceholderText(/Scan barcode or enter manually/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit/i })).toBeInTheDocument();
  });

  it('calls onScan with the entered barcode when button is clicked', () => {
    const mockOnScan = jest.fn();
    render(<Scanner onScan={mockOnScan} />);

    fireEvent.change(screen.getByPlaceholderText(/Scan barcode or enter manually/i), {
      target: { value: '12345' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit/i }));

    expect(mockOnScan).toHaveBeenCalledWith('12345');
    expect(screen.getByPlaceholderText(/Scan barcode or enter manually/i)).toHaveValue(''); // Input should be cleared
  });

  it('calls onScan with the entered barcode when form is submitted', () => {
    const mockOnScan = jest.fn();
    render(<Scanner onScan={mockOnScan} />);

    const input = screen.getByPlaceholderText(/Scan barcode or enter manually/i);
    fireEvent.change(input, {
      target: { value: '67890' },
    });
    
    // Submit the form
    const form = input.closest('form');
    fireEvent.submit(form!);

    expect(mockOnScan).toHaveBeenCalledWith('67890');
    expect(screen.getByPlaceholderText(/Scan barcode or enter manually/i)).toHaveValue(''); // Input should be cleared
  });

  it('does not call onScan if barcode is empty', () => {
    const mockOnScan = jest.fn();
    render(<Scanner onScan={mockOnScan} />);

    fireEvent.click(screen.getByRole('button', { name: /Submit/i }));
    expect(mockOnScan).not.toHaveBeenCalled();
  });
});
