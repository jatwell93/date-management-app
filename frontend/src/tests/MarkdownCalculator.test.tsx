import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownCalculator } from '../components/MarkdownCalculator';
import '@testing-library/jest-dom';

describe('MarkdownCalculator', () => {
  const mockToken = 'fake-token';

  it('renders the markdown calculator form', () => {
    render(<MarkdownCalculator token={mockToken} />);
    expect(screen.getByLabelText(/Cost Price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Expiry Date/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Calculate Markdown/i })).toBeInTheDocument();
  });

  it('calculates markdown price correctly for items expiring within 30 days', () => {
    render(<MarkdownCalculator token={mockToken} />);

    // Set cost price
    fireEvent.change(screen.getByLabelText(/Cost Price/i), {
      target: { value: '100' },
    });

    // Set expiry date to 15 days from now (Markdown 3 - 20% off)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    const dateString = futureDate.toISOString().split('T')[0];

    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: dateString },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));

    expect(screen.getByText(/Markdown 3/i)).toBeInTheDocument();
    expect(screen.getByText(/\$80.00/i)).toBeInTheDocument();
  });

  it('displays Normal status when no expiry date is set', () => {
    render(<MarkdownCalculator token={mockToken} />);

    // Default state should show Normal
    expect(screen.getByText(/Normal/i)).toBeInTheDocument();
  });

  it('displays Expired status for items past expiry date', () => {
    render(<MarkdownCalculator token={mockToken} />);

    // Set cost price
    fireEvent.change(screen.getByLabelText(/Cost Price/i), {
      target: { value: '50' },
    });

    // Set expiry date to yesterday
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const dateString = pastDate.toISOString().split('T')[0];

    fireEvent.change(screen.getByLabelText(/Expiry Date/i), {
      target: { value: dateString },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));

    expect(screen.getByText(/Expired/i)).toBeInTheDocument();
  });
});
