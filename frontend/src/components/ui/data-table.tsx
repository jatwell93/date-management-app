import React from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  SortingState,
  PaginationState,
  FilterFn,
} from '@tanstack/react-table';
import { cn } from '../../lib/utils';

import { Button } from './button';
import { Input } from './input';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: string;
  pagination?: boolean;
  sorting?: boolean;
  filtering?: boolean;
}

// Global filter function
const fuzzyFilter: FilterFn<any> = (row, columnId, filterValue) => {
  const searchTerms = filterValue?.toLowerCase().split(/\s+/) || [];
  const cellValue = String(row.getValue(columnId)).toLowerCase();

  return searchTerms.every((term: string) => cellValue.includes(term));
};

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey: _searchKey = 'id',
  pagination = true,
  sorting = true,
  filtering = true,
}: DataTableProps<TData, TValue>) {
  const [sortingState, setSortingState] = React.useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [paginationState, setPaginationState] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting: sortingState,
      globalFilter,
      pagination: paginationState,
    },
    onSortingChange: setSortingState,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPaginationState,
    globalFilterFn: fuzzyFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: pagination ? getPaginationRowModel() : undefined,
    getSortedRowModel: sorting ? getSortedRowModel() : undefined,
    getFilteredRowModel: filtering ? getFilteredRowModel() : undefined,
  });

  return (
    <div className="w-full space-y-4 overflow-x-auto">
      {filtering && (
        <div className="flex items-center py-4">
          <Input
            placeholder="Search all columns..."
            value={globalFilter ?? ''}
            onChange={(event) => setGlobalFilter(event.target.value)}
            className="max-w-sm"
          />
        </div>
      )}
      <div className="rounded-md border:none">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'h-12 px-4 text-left align-middle font-medium text-slate-500 dark:text-slate-400 [&:has([role=checkbox])]:pr-0 min-w-[120px] first:min-w-[100px] last:min-w-[140px]',
                        header.column.getCanSort() && 'cursor-pointer select-none',
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                      {{
                        asc: ' 🔼',
                        desc: ' 🔽',
                      }[header.column.getIsSorted() as string] ?? null}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t transition-colors hover:bg-slate-500/50 data-[state=selected]:bg-slate-100 dark:data-[state=selected]:bg-slate-800"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="p-4 align-middle [&:has([role=checkbox])]:pr-0 min-w-[120px] first:min-w-[100px] last:min-w-[140px]"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="h-24 text-center align-middle">
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagination && (
        <div className="flex items-center justify-between space-x-2 py-4 overflow-x-auto">
          <div className="flex-1 text-sm text-slate-500 dark:text-slate-400">
            Showing{' '}
            {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
              table.getFilteredRowModel().rows.length,
            )}{' '}
            of {table.getFilteredRowModel().rows.length} entries
          </div>
          <div className="flex items-center space-x-2 overflow-x-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <div className="flex items-center gap-1">
              {[...Array(table.getPageCount())].map((_, i) => (
                <Button
                  key={i}
                  variant={i === table.getState().pagination.pageIndex ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => table.setPageIndex(i)}
                >
                  {i + 1}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
