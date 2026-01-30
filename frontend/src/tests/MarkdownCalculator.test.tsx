import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownCalculator } from '../components/MarkdownCalculator';
import '@testing-library/jest-dom';

describe('MarkdownCalculator', () => {
  const mockToken = 'fake-token';

  it('renders the markdown calculator form', () => {
    render(<MarkdownCalculator token={mockToken} />);
    expect(screen.getByLabelText(/Original Price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Markdown Percentage \(%\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Calculate Markdown/i })).toBeInTheDocument();
  });

  it('calculates markdown price correctly', () => {
    render(<MarkdownCalculator token={mockToken} />);

    fireEvent.change(screen.getByLabelText(/Original Price/i), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByLabelText(/Markdown Percentage \(%\)/i), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));

    expect(screen.getByText(/\$80.00/i)).toBeInTheDocument();
  });

  it('displays no markdown price if inputs are invalid', () => {
    render(<MarkdownCalculator token={mockToken} />);

    fireEvent.change(screen.getByLabelText(/Original Price/i), {
      target: { value: 'abc' },
    });
    fireEvent.change(screen.getByLabelText(/Markdown Percentage \(%\)/i), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));

    expect(screen.queryByText(/Markdown Price:/i)).not.toBeInTheDocument();
  });

  it('clears markdown price when inputs are changed after a calculation', () => {
    render(<MarkdownCalculator token={mockToken} />);

    fireEvent.change(screen.getByLabelText(/Original Price/i), {
      target: { value: '100' },
    });
    fireEvent.change(screen.getByLabelText(/Markdown Percentage \(%\)/i), {
      target: { value: '20' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Calculate Markdown/i }));
    expect(screen.getByText(/\$80.00/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Original Price/i), {
      target: { value: '50' },
    });
    expect(screen.queryByText(/\$80.00/i)).not.toBeInTheDocument();
  });
});
