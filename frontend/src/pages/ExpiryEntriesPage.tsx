import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { apiService } from '../lib/api.service';
import { calculateMarkdownPrice } from '../lib/utils';
import { DataTable } from '../components/ui/data-table';
import { DataTableColumnHeader } from '../components/ui/data-table-column-header';
import { ColumnDef } from '@tanstack/react-table';
import Toast from '../components/ui/toast';
import { useFreshApiToken } from '../hooks/useFreshApiToken';
import { hasPermission, PERMISSIONS, RoleValue } from '../constants/roles';

interface ExpiryEntriesPageProps {
  token: string | null;
  role: RoleValue | null;
}

interface ExpiryEntryItem {
  inventoryId: number;
  expiryDate: string; // Format: YYYY-MM-DD
  status: string;
  productId: number;
  productName: string;
  sku: string;
  costPrice: number;
  locationId: number;
  locationName: string;
  subDepartment: string | null;
}

interface EditableInventoryItem {
  inventoryId: number;
  expiryDate: string;
  locationId: number;
}

interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  visible: boolean;
}

const ALL_LOCATIONS = '__all__';

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});
const dateFormatter = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' });

function formatCurrencyValue(value: number): string {
  return Number.isFinite(value) ? currencyFormatter.format(value) : 'Not available';
}

function getDaysToExpiry(expiryDate: string) {
  const parsedExpiryDate = new Date(expiryDate);
  if (Number.isNaN(parsedExpiryDate.getTime())) {
    return null;
  }

  const today = new Date();
  return Math.ceil((parsedExpiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatExpiryDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not available' : dateFormatter.format(date);
}

function getMarkdownStatus(daysToExpiry: number | null) {
  if (daysToExpiry === null) return 'Review date';
  if (daysToExpiry <= 0) return 'Expired';
  if (daysToExpiry <= 30) return 'Markdown 3';
  if (daysToExpiry <= 60) return 'Markdown 2';
  if (daysToExpiry <= 90) return 'Markdown 1';
  return 'Normal';
}

function getMobileBadgeClass(daysToExpiry: number | null): string {
  if (daysToExpiry === null) return 'bg-semantic-secondary-muted text-semantic-text-secondary';
  if (daysToExpiry <= 0) return 'bg-semantic-critical-muted text-semantic-critical';
  if (daysToExpiry <= 90) return 'bg-semantic-warning-muted text-semantic-warning-muted-foreground';
  return 'bg-semantic-success-muted text-semantic-success';
}

function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-4" aria-hidden="true">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className="h-4 w-28 rounded bg-semantic-surface-4" />
          <div className="h-4 w-44 rounded bg-semantic-surface-4" />
          <div className="h-4 w-24 rounded bg-semantic-surface-4" />
          <div className="h-4 w-20 rounded bg-semantic-surface-4" />
          <div className="h-4 w-16 rounded bg-semantic-surface-4" />
        </div>
      ))}
    </div>
  );
}

export function ExpiryEntriesPage({ token, role }: ExpiryEntriesPageProps) {
  const getFreshApiToken = useFreshApiToken(token);
  // Only admins (manage_members) may delete entries; everyone can edit typos.
  const canDelete = !!role && hasPermission(role, PERMISSIONS.MANAGE_MEMBERS);
  const [reportData, setReportData] = useState<ExpiryEntryItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<EditableInventoryItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<number | null>(null);
  const [locationFilter, setLocationFilter] = useState<string>(ALL_LOCATIONS);
  const [storeAreas, setStoreAreas] = useState<{ id: number; name: string }[]>([]);
  const [storeAreasError, setStoreAreasError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>({ message: '', type: 'success', visible: false });

  const showToast = useCallback((message: string, type: ToastState['type']) => {
    setToast({ message, type, visible: true });
  }, []);

  const fetchReportData = useCallback(
    async (signal?: AbortSignal) => {
      if (!token) {
        setFetchError('Authentication token is missing.');
        setLoading(false);
        return;
      }
      try {
        const authToken = await getFreshApiToken('expiry-entries-fetch');
        const data = await apiService.get<ExpiryEntryItem[]>(
          '/reports/expiry-entries',
          authToken,
          signal,
        );
        if (!signal?.aborted) {
          setReportData(data);
          setFetchError(null);
        }
      } catch (err: unknown) {
        if (!signal?.aborted) {
          setFetchError(
            err instanceof Error ? err.message : 'Failed to load expiry entries. Please try again.',
          );
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [token, getFreshApiToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchReportData(controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchReportData]);

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();

    const fetchStoreAreas = async () => {
      try {
        const authToken = await getFreshApiToken('expiry-entries-store-areas');
        const data = await apiService.get<{ id: number; name: string }[]>(
          '/store-areas',
          authToken,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setStoreAreas(data);
          setStoreAreasError(null);
        }
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          setStoreAreasError(err instanceof Error ? err.message : 'Failed to load store areas.');
        }
      }
    };

    fetchStoreAreas();
    return () => {
      controller.abort();
    };
  }, [token, getFreshApiToken]);

  const handleSaveEdit = useCallback(async (): Promise<boolean> => {
    if (!editingItem) return true;
    if (!token) {
      setActionError('Authentication token is missing.');
      return false;
    }
    setSaving(true);
    setActionError(null);
    try {
      const authToken = await getFreshApiToken('expiry-entries-update');
      await apiService.put(
        `/inventory-items/${editingItem.inventoryId}`,
        { expiryDate: editingItem.expiryDate, locationId: editingItem.locationId },
        authToken,
      );
      const updatedData = await apiService.get<ExpiryEntryItem[]>(
        '/reports/expiry-entries',
        authToken,
      );
      setReportData(updatedData);
      setEditingItem(null);
      showToast('Item updated successfully.', 'success');
      return true;
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to update item. Please try again.',
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [editingItem, token, getFreshApiToken, showToast]);

  const handleEdit = useCallback(
    async (item: ExpiryEntryItem) => {
      if (editingItem && editingItem.inventoryId !== item.inventoryId) {
        const saved = await handleSaveEdit();
        if (!saved) {
          return;
        }
      }
      setActionError(null);
      setEditingItem({
        inventoryId: item.inventoryId,
        expiryDate: item.expiryDate,
        locationId: item.locationId,
      });
    },
    [editingItem, handleSaveEdit],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingItem(null);
    setActionError(null);
  }, []);

  const handleDelete = useCallback(
    async (inventoryId: number) => {
      if (!token) {
        setActionError('Authentication token is missing.');
        return;
      }
      setDeleting(true);
      setActionError(null);
      try {
        const authToken = await getFreshApiToken('expiry-entries-delete');
        await apiService.delete(`/inventory-items/${inventoryId}`, authToken);
        const updatedData = await apiService.get<ExpiryEntryItem[]>(
          '/reports/expiry-entries',
          authToken,
        );
        setReportData(updatedData);
        setDeleteConfirmation(null);
        showToast('Item deleted.', 'success');
      } catch (err: unknown) {
        setActionError(
          err instanceof Error ? err.message : 'Failed to delete item. Please try again.',
        );
      } finally {
        setDeleting(false);
      }
    },
    [token, getFreshApiToken, showToast],
  );

  const confirmDelete = useCallback((inventoryId: number) => {
    setDeleteConfirmation(inventoryId);
    setActionError(null);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteConfirmation(null);
  }, []);

  // Define columns for the data table
  const columns: ColumnDef<ExpiryEntryItem>[] = useMemo(
    () => [
      {
        accessorKey: 'expiryDate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expiry Date" />,
        cell: ({ row }) => {
          const isEditing = editingItem && editingItem.inventoryId === row.original.inventoryId;

          if (isEditing) {
            return (
              <div className="min-w-[140px]">
                <Input
                  type="date"
                  value={editingItem.expiryDate}
                  onChange={(e) =>
                    setEditingItem({
                      ...editingItem,
                      expiryDate: e.target.value,
                    })
                  }
                  className="w-full"
                  disabled={saving}
                />
              </div>
            );
          }

          const daysToExpiry = getDaysToExpiry(row.original.expiryDate);
          return (
            <div
              className={`min-w-[140px] ${daysToExpiry !== null && daysToExpiry <= 0 ? 'text-semantic-critical font-bold' : ''}`}
            >
              {formatExpiryDate(row.original.expiryDate)}
              <div className="text-xs text-semantic-text-tertiary">
                {daysToExpiry === null
                  ? ''
                  : daysToExpiry > 0
                    ? `${daysToExpiry} days left`
                    : 'Expired'}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: 'productName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Product Name" />,
        cell: ({ row }) => (
          <div
            className="font-medium min-w-[160px] max-w-[200px] truncate"
            title={row.original.productName}
          >
            {row.original.productName}
          </div>
        ),
      },
      {
        accessorKey: 'sku',
        header: ({ column }) => <DataTableColumnHeader column={column} title="SKU" />,
        cell: ({ row }) => (
          <div className="min-w-[100px] max-w-[140px] truncate" title={row.original.sku}>
            {row.original.sku}
          </div>
        ),
      },
      {
        accessorKey: 'costPrice',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Cost Price" />,
        cell: ({ row }) => (
          <div className="min-w-[100px] tabular-nums">
            {formatCurrencyValue(row.original.costPrice)}
          </div>
        ),
      },
      {
        accessorKey: 'daysToExpiry',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Days to Expiry" />,
        cell: ({ row }) => {
          const isEditing = editingItem && editingItem.inventoryId === row.original.inventoryId;
          const daysToExpiry = isEditing
            ? getDaysToExpiry(editingItem.expiryDate)
            : getDaysToExpiry(row.original.expiryDate);

          const urgencyClass =
            daysToExpiry === null
              ? ''
              : daysToExpiry <= 0
                ? 'text-semantic-critical font-bold'
                : daysToExpiry <= 30
                  ? 'text-semantic-warning font-semibold'
                  : '';

          return (
            <div className={`min-w-[100px] tabular-nums ${urgencyClass}`}>
              {daysToExpiry === null ? '—' : daysToExpiry}
            </div>
          );
        },
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Markdown Status" />,
        cell: ({ row }) => {
          const isEditing = editingItem && editingItem.inventoryId === row.original.inventoryId;
          const daysToExpiry = isEditing
            ? getDaysToExpiry(editingItem.expiryDate)
            : getDaysToExpiry(row.original.expiryDate);
          const markdownStatus = getMarkdownStatus(daysToExpiry);

          const statusClass =
            markdownStatus === 'Expired'
              ? 'text-semantic-critical'
              : markdownStatus.startsWith('Markdown')
                ? 'text-semantic-warning'
                : 'text-semantic-text-secondary';

          return (
            <div className={`min-w-[120px] text-sm font-medium ${statusClass}`}>
              {markdownStatus}
            </div>
          );
        },
      },
      {
        accessorKey: 'markdownPrice',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Markdown Price" />,
        cell: ({ row }) => {
          const isEditing = editingItem && editingItem.inventoryId === row.original.inventoryId;
          const daysToExpiry = isEditing
            ? getDaysToExpiry(editingItem.expiryDate)
            : getDaysToExpiry(row.original.expiryDate);
          const markdownPrice =
            daysToExpiry === null
              ? row.original.costPrice
              : calculateMarkdownPrice(row.original.costPrice, daysToExpiry);

          return (
            <div className="min-w-[100px] tabular-nums">{formatCurrencyValue(markdownPrice)}</div>
          );
        },
      },
      {
        accessorKey: 'locationName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Location" />,
        cell: ({ row }) => {
          const isEditing = editingItem && editingItem.inventoryId === row.original.inventoryId;

          if (isEditing) {
            return (
              <div className="min-w-[120px]">
                {storeAreasError ? (
                  <p className="text-xs text-semantic-critical">{storeAreasError}</p>
                ) : (
                  <Select
                    value={editingItem.locationId.toString()}
                    onValueChange={(value) =>
                      setEditingItem({
                        ...editingItem,
                        locationId: parseInt(value, 10),
                      })
                    }
                    disabled={saving || storeAreas.length === 0}
                  >
                    <SelectTrigger className="w-full" aria-label="Location">
                      <SelectValue
                        placeholder={storeAreas.length === 0 ? 'Loading…' : 'Location'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {storeAreas.map((area) => (
                        <SelectItem key={area.id} value={area.id.toString()}>
                          {area.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            );
          }

          return (
            <div className="min-w-[120px] max-w-[160px] truncate" title={row.original.locationName}>
              {row.original.locationName}
            </div>
          );
        },
      },
      {
        accessorKey: 'subDepartment',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Sub-Department" />,
        cell: ({ row }) => (
          <div
            className="min-w-[120px] max-w-[140px] truncate"
            title={row.original.subDepartment || 'N/A'}
          >
            {row.original.subDepartment || 'N/A'}
          </div>
        ),
      },
      {
        id: 'actions',
        header: () => <div className="min-w-[140px]">Actions</div>,
        cell: ({ row }) => {
          const rowId = row.original.inventoryId;
          const isEditing = editingItem && editingItem.inventoryId === rowId;
          const isPendingDelete = deleteConfirmation === rowId;
          const anotherRowEditing = editingItem && editingItem.inventoryId !== rowId;

          if (isPendingDelete && canDelete) {
            return (
              <div className="flex gap-2 justify-start min-w-[140px]">
                <Button
                  onClick={() => handleDelete(rowId)}
                  disabled={deleting}
                  size="sm"
                  variant="destructive"
                  className="text-xs flex-shrink-0 min-w-[70px]"
                  aria-busy={deleting}
                >
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </Button>
                <Button
                  onClick={cancelDelete}
                  disabled={deleting}
                  size="sm"
                  variant="neutral"
                  className="text-xs flex-shrink-0 min-w-[60px]"
                >
                  Cancel
                </Button>
              </div>
            );
          }

          if (isEditing) {
            return (
              <div className="flex gap-2 justify-start min-w-[140px]">
                <Button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  size="sm"
                  variant="success"
                  className="min-w-[50px] font-medium"
                  aria-busy={saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  onClick={handleCancelEdit}
                  disabled={saving}
                  size="sm"
                  variant="neutral"
                  className="min-w-[50px] font-medium"
                >
                  Cancel
                </Button>
              </div>
            );
          }

          return (
            <div className="flex gap-2 justify-start min-w-[140px]">
              <Button
                onClick={() => handleEdit(row.original)}
                disabled={!!anotherRowEditing || deleting}
                size="sm"
                variant="default"
                className="min-w-[50px] font-medium"
              >
                Edit
              </Button>
              {canDelete && (
                <Button
                  onClick={() => confirmDelete(rowId)}
                  disabled={!!editingItem || deleting}
                  size="sm"
                  variant="destructive"
                  className="min-w-[50px] font-medium"
                >
                  Delete
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [
      editingItem,
      saving,
      deleting,
      deleteConfirmation,
      canDelete,
      storeAreas,
      storeAreasError,
      handleSaveEdit,
      handleCancelEdit,
      handleEdit,
      handleDelete,
      confirmDelete,
      cancelDelete,
    ],
  );

  const retryControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      retryControllerRef.current?.abort();
    };
  }, []);

  const handleRetryFetch = useCallback(() => {
    retryControllerRef.current?.abort();
    const controller = new AbortController();
    retryControllerRef.current = controller;
    setFetchError(null);
    setLoading(true);
    fetchReportData(controller.signal);
  }, [fetchReportData]);

  // Distinct location names present in the data — drives the location filter so
  // users can narrow a large list to a single store area.
  const locationOptions = useMemo(() => {
    const names = new Set<string>();
    for (const item of reportData || []) {
      if (item.locationName) names.add(item.locationName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [reportData]);

  const filteredData = useMemo(() => {
    if (!reportData) return [];
    if (locationFilter === ALL_LOCATIONS) return reportData;
    return reportData.filter((item) => item.locationName === locationFilter);
  }, [reportData, locationFilter]);

  if (loading) {
    return (
      <main
        className="container mx-auto max-w-7xl space-y-6 p-4"
        aria-label="All expiry entries workspace"
      >
        <header className="mb-5">
          <div
            className="h-7 w-72 animate-pulse rounded bg-semantic-surface-4"
            aria-hidden="true"
          />
          <div
            className="mt-2 h-4 w-96 animate-pulse rounded bg-semantic-surface-4"
            aria-hidden="true"
          />
        </header>
        <Card className="overflow-hidden">
          <CardHeader>
            <div
              className="h-6 w-36 animate-pulse rounded bg-semantic-surface-4"
              aria-hidden="true"
            />
          </CardHeader>
          <CardContent className="p-0 sm:p-6">
            <TableSkeleton />
          </CardContent>
        </Card>
        <p className="sr-only" role="status" aria-live="polite">
          Loading all expiry entries…
        </p>
      </main>
    );
  }

  if (fetchError) {
    return (
      <main className="container mx-auto max-w-7xl p-4" aria-label="All expiry entries workspace">
        <div
          role="alert"
          className="rounded-lg border border-semantic-critical-muted bg-semantic-critical-muted p-6 text-center"
        >
          <p className="font-medium text-semantic-critical">{fetchError}</p>
          <Button onClick={handleRetryFetch} variant="default" className="mt-4">
            Try again
          </Button>
        </div>
      </main>
    );
  }

  const hasData = reportData && reportData.length > 0;

  return (
    <main
      className="print-report-root container mx-auto max-w-7xl space-y-6 p-4"
      aria-label="All expiry entries workspace"
    >
      <header className="mb-5">
        <div className="flex items-center justify-between">
          <h1 className="font-heading text-2xl font-semibold">All Expiry Entries</h1>
          <button
            onClick={() => window.print()}
            aria-label="Print this report"
            className="hidden md:flex items-center gap-2 rounded-md border border-semantic-primary px-3 py-1.5 text-sm font-medium text-semantic-primary hover:bg-semantic-primary/5 transition-colors no-print"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9V2h12v7" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print Report
          </button>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-semantic-text-secondary">
          Browse and sort every active expiry entry. Fix data-entry errors by editing an item&apos;s
          date or location{canDelete ? ', or delete entries that were logged in error.' : '.'}
        </p>
      </header>

      {actionError && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center justify-between gap-4 rounded-lg border border-semantic-critical-muted bg-semantic-critical-muted px-4 py-3 text-sm text-semantic-critical"
        >
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
            className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
          >
            &times;
          </button>
        </div>
      )}

      {hasData ? (
        <ul className="mb-5 space-y-3 md:hidden" aria-label="Mobile expiry entry summary">
          {filteredData.slice(0, 50).map((item) => {
            const daysToExpiry = getDaysToExpiry(item.expiryDate);
            const markdownPrice =
              daysToExpiry === null
                ? item.costPrice
                : calculateMarkdownPrice(item.costPrice, daysToExpiry);

            return (
              <li key={item.inventoryId} className="rounded-lg border bg-semantic-surface-1 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-medium">{item.productName}</p>
                    <p className="mt-1 text-sm text-semantic-text-secondary">
                      {item.sku} · {item.locationName}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${getMobileBadgeClass(daysToExpiry)}`}
                  >
                    {getMarkdownStatus(daysToExpiry)}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-semantic-text-secondary">Expiry</dt>
                    <dd className="font-medium">{formatExpiryDate(item.expiryDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-semantic-text-secondary">Markdown price</dt>
                    <dd className="font-medium">{formatCurrencyValue(markdownPrice)}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Card className="print-report-target overflow-hidden">
        <CardHeader className="gap-4 sm:flex sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>
            <h2 className="text-xl font-semibold">Expiry entries</h2>
          </CardTitle>
          {hasData ? (
            <div className="no-print flex items-center gap-2">
              <label
                htmlFor="location-filter"
                className="text-sm font-medium text-semantic-text-secondary"
              >
                Location
              </label>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger
                  id="location-filter"
                  className="w-[200px]"
                  aria-label="Filter by location"
                >
                  <SelectValue placeholder="All locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_LOCATIONS}>All locations</SelectItem>
                  {locationOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-0 sm:p-6">
          {hasData ? (
            <>
              <div className="overflow-x-auto pb-4 no-print">
                <div className="min-w-[1000px] px-4 sm:px-0">
                  <DataTable
                    columns={columns}
                    data={filteredData}
                    filtering={true}
                    pagination={true}
                    sorting={true}
                  />
                </div>
              </div>
              <div className="print-only">
                <div className="overflow-x-auto">
                  <table
                    className="w-full border-collapse text-sm"
                    aria-label="Printable expiry entries table"
                  >
                    <thead>
                      <tr>
                        <th className="border-b px-4 py-3 text-left font-semibold">SKU</th>
                        <th className="border-b px-4 py-3 text-left font-semibold">Product Name</th>
                        <th className="border-b px-4 py-3 text-left font-semibold">Location</th>
                        <th className="border-b px-4 py-3 text-left font-semibold">Expiry Date</th>
                        <th className="border-b px-4 py-3 text-left font-semibold">Cost Price</th>
                        <th className="border-b px-4 py-3 text-left font-semibold">
                          Sub-Department
                        </th>
                        <th className="border-b px-4 py-3 text-left font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredData.map((item) => (
                        <tr key={item.inventoryId} className="border-b">
                          <td className="px-4 py-3 align-top">{item.sku}</td>
                          <td className="px-4 py-3 align-top">{item.productName}</td>
                          <td className="px-4 py-3 align-top">{item.locationName}</td>
                          <td className="px-4 py-3 align-top">
                            {formatExpiryDate(item.expiryDate)}
                          </td>
                          <td className="px-4 py-3 align-top">
                            {formatCurrencyValue(item.costPrice)}
                          </td>
                          <td className="px-4 py-3 align-top">{item.subDepartment || 'N/A'}</td>
                          <td className="px-4 py-3 align-top">{item.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-semantic-text-secondary">
              No active expiry entries found.
            </p>
          )}
        </CardContent>
      </Card>

      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.visible}
        onClose={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </main>
  );
}
