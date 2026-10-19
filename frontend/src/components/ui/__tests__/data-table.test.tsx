import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ColumnDef } from '@tanstack/react-table';

import { DataTable } from '../data-table';

interface Row {
  name: string;
}

const columns: ColumnDef<Row, unknown>[] = [{ accessorKey: 'name', header: 'Name' }];
const rows = (count: number, label = 'Item') =>
  Array.from({ length: count }, (_, i) => ({ name: `${label} ${i + 1}` }));

describe('DataTable pagination', () => {
  it('stays on the current page when the data changes', async () => {
    const { rerender } = render(<DataTable columns={columns} data={rows(25)} />);
    // TanStack only starts auto-resetting after the table registers on a later tick.
    await act(() => Promise.resolve());

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText('Item 11')).toBeInTheDocument();

    // Saving an edit replaces the data array; the user must not be sent back to page 1.
    rerender(<DataTable columns={columns} data={rows(25, 'Edited')} />);
    // TanStack queues its page reset in a microtask; flush it before asserting.
    await act(() => Promise.resolve());
    expect(screen.getByText('Edited 11')).toBeInTheDocument();
    expect(screen.getByText(/^Showing 11 to 20 of 25 entries$/)).toBeInTheDocument();
  });

  it('moves to the last page when the current page no longer exists', async () => {
    const { rerender } = render(<DataTable columns={columns} data={rows(21)} />);

    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByText('Item 21')).toBeInTheDocument();

    rerender(<DataTable columns={columns} data={rows(20)} />);
    expect(await screen.findByText('Item 20')).toBeInTheDocument();
    expect(screen.queryByText('No results.')).not.toBeInTheDocument();
  });

  it('goes back to page 1 when the search changes', () => {
    render(<DataTable columns={columns} data={rows(25)} />);

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.change(screen.getByPlaceholderText('Search all columns...'), {
      target: { value: 'Item' },
    });

    expect(screen.getByText('Item 1')).toBeInTheDocument();
  });

  it('goes back to page 1 when the sort changes', () => {
    render(<DataTable columns={columns} data={rows(25)} />);

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('columnheader', { name: 'Name' }));

    expect(screen.getByText(/^Showing 1 to 10 of 25 entries$/)).toBeInTheDocument();
  });
});
