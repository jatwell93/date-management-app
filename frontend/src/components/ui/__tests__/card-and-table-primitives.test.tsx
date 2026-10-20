import { render, screen } from '@testing-library/react';

import { CardDescription, CardTitle } from '../card';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '../alert-dialog';

describe('CardTitle', () => {
  it('stays a div by default', () => {
    render(<CardTitle>Stock on hand</CardTitle>);

    const title = screen.getByText('Stock on hand');
    expect(title.tagName).toBe('DIV');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it.each([1, 2, 3, 4, 5, 6] as const)('renders as an h%i when asked', (level) => {
    render(<CardTitle as={`h${level}`}>Expiring this week</CardTitle>);

    const heading = screen.getByRole('heading', { level, name: 'Expiring this week' });
    expect(heading).toHaveAttribute('data-slot', 'card-title');
    expect(heading).toHaveClass('font-heading');
  });
});

describe('CardDescription', () => {
  it('defaults to 16px body text and still accepts a 14px override', () => {
    const { rerender } = render(<CardDescription>Details</CardDescription>);
    expect(screen.getByText('Details')).toHaveClass('text-base');

    rerender(<CardDescription className="text-sm">Details</CardDescription>);
    expect(screen.getByText('Details')).toHaveClass('text-sm');
    expect(screen.getByText('Details')).not.toHaveClass('text-base');
  });
});

describe('TableHead', () => {
  it('is 14px and wraps by default', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Supplier credit status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody />
      </Table>,
    );

    const head = screen.getByRole('columnheader', { name: 'Supplier credit status' });
    expect(head).toHaveClass('text-sm');
    expect(head).not.toHaveClass('whitespace-nowrap');
  });
});

describe('AlertDialogAction', () => {
  it('accepts a button variant and keeps the default variant otherwise', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Delete area?</AlertDialogTitle>
          <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
          <AlertDialogAction>Keep</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-semantic-critical');
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveClass('bg-semantic-primary');
  });
});
