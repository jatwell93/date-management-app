import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
import { calendarDaysUntil } from '../lib/utils';
import { calculateMarkdownPrice } from '@shared/markdown';
import { useMarkdownMatrices } from '../hooks/useMarkdownMatrix';
import type { MarkdownCreditContext } from '@shared/markdown-credit-context';
import { MarkdownCreditScopeBadge } from '../components/MarkdownCreditScopeBadge';
import { MarkdownMatricesNotice } from '../components/MarkdownMatricesNotice';
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

interface ExpiryEntryItem extends MarkdownCreditContext {
  inventoryId: number;
  expiryDate: string; // Format: YYYY-MM-DD
  status: string;
  productId: number;
  productName: string;
  sku: string;
  costPrice: number;
  retailPrice: number | null;
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
const MOBILE_SUMMARY_LIMIT = 50;
const PAGE_HEADING_ID = 'expiry-entries-page-heading';
const TABLE_HEADING_ID = 'expiry-entries-table-heading';

const editButtonId = (inventoryId: number) => `expiry-entry-edit-${inventoryId}`;
const editDateInputId = (inventoryId: number) => `expiry-entry-edit-date-${inventoryId}`;
const deleteButtonId = (inventoryId: number) => `expiry-entry-delete-${inventoryId}`;
const deleteCancelButtonId = (inventoryId: number) => `expiry-entry-delete-cancel-${inventoryId}`;
const deleteConfirmButtonId = (inventoryId: number) => `expiry-entry-delete-confirm-${inventoryId}`;
const saveButtonId = (inventoryId: number) => `expiry-entry-save-${inventoryId}`;

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
});
const dateFormatter = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' });

function formatCurrencyValue(value: number): string {
  return Number.isFinite(value) ? currencyFormatter.format(value) : 'Not available';
}

function getDaysToExpiry(expiryDate: string) {
  const days = calendarDaysUntil(expiryDate);
  return Number.isNaN(days) ? null : days;
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
  if (daysToExpiry <= 0)
    return 'bg-semantic-critical-muted text-semantic-critical-muted-foreground';
  if (daysToExpiry <= 90) return 'bg-semantic-warning-muted text-semantic-warning-muted-foreground';
  return 'bg-semantic-success-muted text-semantic-success-muted-foreground';
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

/** Focus the first element whose id is currently rendered; later ids are fallbacks. */
function focusFirstRendered(ids: string[]) {
  const target = ids
    .map((id) => document.getElementById(id))
    .find((el): el is HTMLElement => el !== null);
  target?.focus();
}

interface RowActionsContextValue {
  editingItem: EditableInventoryItem | null;
  setEditingItem: React.Dispatch<React.SetStateAction<EditableInventoryItem | null>>;
  saving: boolean;
  deleting: boolean;
  deleteConfirmation: number | null;
  canDelete: boolean;
  matrices: ReturnType<typeof useMarkdownMatrices>['matrices'];
  storeAreas: { id: number; name: string }[];
  storeAreasError: string | null;
  onSave: () => Promise<boolean>;
  onCancelEdit: () => void;
  onEdit: (item: ExpiryEntryItem) => void;
  onDelete: (inventoryId: number) => void;
  onConfirmDelete: (inventoryId: number) => void;
  onCancelDelete: (inventoryId: number) => void;
}

// Carries edit/action state to the table cells so the column definitions can stay
// stable (see the `columns` memo in ExpiryEntriesPage).
const RowActionsContext = React.createContext<RowActionsContextValue | null>(null);

function useRowActions(): RowActionsContextValue {
  const ctx = useContext(RowActionsContext);
  if (!ctx) throw new Error('Expiry entry cells must render inside RowActionsContext.');
  return ctx;
}

interface RowCellProps {
  item: ExpiryEntryItem;
}

/** Day count for a row, reflecting the unsaved date while that row is being edited. */
function useLiveDaysToExpiry(item: ExpiryEntryItem): number | null {
  const { editingItem } = useRowActions();
  const isEditing = editingItem?.inventoryId === item.inventoryId;
  return getDaysToExpiry(isEditing ? editingItem.expiryDate : item.expiryDate);
}

function ExpiryDateCell({ item }: RowCellProps) {
  const { editingItem, setEditingItem, saving } = useRowActions();

  if (editingItem?.inventoryId === item.inventoryId) {
    return (
      <div className="min-w-[140px]">
        <Input
          id={editDateInputId(item.inventoryId)}
          type="date"
          aria-label={`Expiry date for ${item.productName}`}
          value={editingItem.expiryDate}
          onChange={(e) => {
            const expiryDate = e.target.value;
            setEditingItem((current) => (current ? { ...current, expiryDate } : current));
          }}
          className="min-h-11 w-full"
          disabled={saving}
        />
      </div>
    );
  }

  const daysToExpiry = getDaysToExpiry(item.expiryDate);
  return (
    <div
      className={`min-w-[140px] ${daysToExpiry !== null && daysToExpiry <= 0 ? 'text-semantic-critical font-bold' : ''}`}
    >
      {formatExpiryDate(item.expiryDate)}
      <div className="text-xs text-semantic-text-tertiary">
        {daysToExpiry === null ? '' : daysToExpiry > 0 ? `${daysToExpiry} days left` : 'Expired'}
      </div>
    </div>
  );
}

function DaysToExpiryCell({ item }: RowCellProps) {
  const daysToExpiry = useLiveDaysToExpiry(item);

  const urgencyClass =
    daysToExpiry === null
      ? ''
      : daysToExpiry <= 0
        ? 'text-semantic-critical font-bold'
        : daysToExpiry <= 30
          ? 'text-semantic-warning-muted-foreground font-semibold'
          : '';

  return (
    <div className={`min-w-[100px] tabular-nums ${urgencyClass}`}>
      {daysToExpiry === null ? (
        <>
          <span aria-hidden="true">—</span>
          <span className="sr-only">Date not available</span>
        </>
      ) : (
        daysToExpiry
      )}
    </div>
  );
}

function MarkdownStatusCell({ item }: RowCellProps) {
  const markdownStatus = getMarkdownStatus(useLiveDaysToExpiry(item));

  const statusClass =
    markdownStatus === 'Expired'
      ? 'text-semantic-critical'
      : markdownStatus.startsWith('Markdown')
        ? 'text-semantic-warning-muted-foreground'
        : 'text-semantic-text-secondary';

  return <div className={`min-w-[120px] text-sm font-medium ${statusClass}`}>{markdownStatus}</div>;
}

function MarkdownPriceCell({ item }: RowCellProps) {
  const { matrices } = useRowActions();
  const daysToExpiry = useLiveDaysToExpiry(item);
  const matrix = matrices?.[item.creditScope ?? 'NO_CREDIT'];
  if (!matrix) {
    return <div className="min-w-[100px] text-sm text-semantic-text-secondary">Unavailable</div>;
  }
  const markdownPrice =
    calculateMarkdownPrice(
      { costPrice: item.costPrice, retailPrice: item.retailPrice },
      daysToExpiry,
      matrix,
    ) ?? item.costPrice;

  return <div className="min-w-[100px] tabular-nums">{formatCurrencyValue(markdownPrice)}</div>;
}

function LocationCell({ item }: RowCellProps) {
  const { editingItem, setEditingItem, saving, storeAreas, storeAreasError } = useRowActions();

  if (editingItem?.inventoryId === item.inventoryId) {
    return (
      <div className="min-w-[120px]">
        {storeAreasError ? (
          <p className="text-xs text-semantic-critical">{storeAreasError}</p>
        ) : (
          <Select
            value={editingItem.locationId.toString()}
            onValueChange={(value) => {
              const locationId = parseInt(value, 10);
              setEditingItem((current) => (current ? { ...current, locationId } : current));
            }}
            disabled={saving || storeAreas.length === 0}
          >
            <SelectTrigger
              className="min-h-11 w-full"
              aria-label={`Location for ${item.productName}`}
            >
              <SelectValue placeholder={storeAreas.length === 0 ? 'Loading…' : 'Location'} />
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
    <div className="min-w-[120px] max-w-[160px] truncate" title={item.locationName}>
      {item.locationName}
    </div>
  );
}

function ActionsCell({ item }: RowCellProps) {
  const {
    editingItem,
    saving,
    deleting,
    deleteConfirmation,
    canDelete,
    onSave,
    onCancelEdit,
    onEdit,
    onDelete,
    onConfirmDelete,
    onCancelDelete,
  } = useRowActions();
  const rowId = item.inventoryId;
  const isEditing = editingItem?.inventoryId === rowId;
  const anotherRowEditing = !!editingItem && editingItem.inventoryId !== rowId;

  if (deleteConfirmation === rowId && canDelete) {
    return (
      <div className="flex gap-2 justify-start min-w-[140px]">
        <Button
          id={deleteConfirmButtonId(rowId)}
          onClick={() => onDelete(rowId)}
          disabled={deleting}
          size="sm"
          variant="destructive"
          className="min-h-11 min-w-[70px] shrink-0"
          aria-busy={deleting}
        >
          {deleting ? 'Deleting…' : 'Confirm delete'}
          <span className="sr-only"> {item.productName}</span>
        </Button>
        <Button
          id={deleteCancelButtonId(rowId)}
          onClick={() => onCancelDelete(rowId)}
          disabled={deleting}
          size="sm"
          variant="neutral"
          className="min-h-11 min-w-[60px] shrink-0"
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
          id={saveButtonId(rowId)}
          onClick={onSave}
          disabled={saving}
          size="sm"
          variant="default"
          className="min-h-11 min-w-[50px] font-medium"
          aria-busy={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          onClick={onCancelEdit}
          disabled={saving}
          size="sm"
          variant="neutral"
          className="min-h-11 min-w-[50px] font-medium"
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2 justify-start min-w-[140px]">
      <Button
        id={editButtonId(rowId)}
        onClick={() => onEdit(item)}
        disabled={anotherRowEditing || deleting}
        size="sm"
        variant="default"
        className="min-h-11 min-w-[50px] font-medium"
      >
        Edit<span className="sr-only"> {item.productName}</span>
      </Button>
      {canDelete && (
        <Button
          id={deleteButtonId(rowId)}
          onClick={() => onConfirmDelete(rowId)}
          disabled={!!editingItem || deleting}
          size="sm"
          variant="destructive"
          className="min-h-11 min-w-[50px] font-medium"
        >
          Delete<span className="sr-only"> {item.productName}</span>
        </Button>
      )}
    </div>
  );
}

export function ExpiryEntriesPage({ token, role }: ExpiryEntriesPageProps) {
  const getFreshApiToken = useFreshApiToken(token);
  const markdownConfig = useMarkdownMatrices(token);
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

  // Row actions swap their buttons out (Edit -> Save/Cancel, Delete -> Confirm/Cancel),
  // which would otherwise drop keyboard focus to <body>. Queue the element id to focus
  // once the next render has mounted it. Later ids are fallbacks, tried in order when
  // an earlier one is not rendered (e.g. the row sorted onto another page).
  const pendingFocusIdsRef = useRef<string[]>([]);
  const queueFocus = useCallback((...ids: string[]) => {
    pendingFocusIdsRef.current = ids;
  }, []);
  useEffect(() => {
    const ids = pendingFocusIdsRef.current;
    pendingFocusIdsRef.current = [];
    focusFirstRendered(ids);
  });

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sets loading before kicking off an abortable fetch
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
      // The row may have sorted onto another page or out of the data; fall back to
      // the table heading rather than letting focus drop to <body>.
      queueFocus(editButtonId(editingItem.inventoryId), TABLE_HEADING_ID);
      setEditingItem(null);
      showToast('Item updated successfully.', 'success');
      return true;
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to update item. Please try again.',
      );
      // Save was disabled while in flight, which blurs it; put focus back on it.
      queueFocus(saveButtonId(editingItem.inventoryId), TABLE_HEADING_ID);
      return false;
    } finally {
      setSaving(false);
    }
  }, [editingItem, token, getFreshApiToken, showToast, queueFocus]);

  const handleEdit = useCallback(
    async (item: ExpiryEntryItem) => {
      if (editingItem && editingItem.inventoryId !== item.inventoryId) {
        const saved = await handleSaveEdit();
        if (!saved) {
          return;
        }
      }
      setActionError(null);
      queueFocus(editDateInputId(item.inventoryId));
      setEditingItem({
        inventoryId: item.inventoryId,
        expiryDate: item.expiryDate,
        locationId: item.locationId,
      });
    },
    [editingItem, handleSaveEdit, queueFocus],
  );

  const handleCancelEdit = useCallback(() => {
    if (editingItem) queueFocus(editButtonId(editingItem.inventoryId), TABLE_HEADING_ID);
    setEditingItem(null);
    setActionError(null);
  }, [editingItem, queueFocus]);

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
        // The row is gone; return focus to the table heading rather than <body>.
        queueFocus(TABLE_HEADING_ID);
        setDeleteConfirmation(null);
        showToast('Item deleted.', 'success');
      } catch (err: unknown) {
        setActionError(
          err instanceof Error ? err.message : 'Failed to delete item. Please try again.',
        );
        // Confirm was disabled while in flight, which blurs it; put focus back on it.
        queueFocus(deleteConfirmButtonId(inventoryId), TABLE_HEADING_ID);
      } finally {
        setDeleting(false);
      }
    },
    [token, getFreshApiToken, showToast, queueFocus],
  );

  const confirmDelete = useCallback(
    (inventoryId: number) => {
      // Land on Cancel, not the destructive confirm, so a stray Enter is safe.
      queueFocus(deleteCancelButtonId(inventoryId));
      setDeleteConfirmation(inventoryId);
      setActionError(null);
    },
    [queueFocus],
  );

  const cancelDelete = useCallback(
    (inventoryId: number) => {
      queueFocus(deleteButtonId(inventoryId), TABLE_HEADING_ID);
      setDeleteConfirmation(null);
    },
    [queueFocus],
  );

  const rowActions = useMemo<RowActionsContextValue>(
    () => ({
      editingItem,
      setEditingItem,
      saving,
      deleting,
      deleteConfirmation,
      canDelete,
      matrices: markdownConfig.matrices,
      storeAreas,
      storeAreasError,
      onSave: handleSaveEdit,
      onCancelEdit: handleCancelEdit,
      onEdit: handleEdit,
      onDelete: handleDelete,
      onConfirmDelete: confirmDelete,
      onCancelDelete: cancelDelete,
    }),
    [
      editingItem,
      saving,
      deleting,
      deleteConfirmation,
      canDelete,
      markdownConfig.matrices,
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

  // Column definitions must keep a stable identity while a row is being edited:
  // TanStack's flexRender treats each `cell` function as a component type, so a
  // new array on every keystroke would remount the edit inputs and drop focus.
  // Edit and action state reaches the cells through RowActionsContext instead.
  // Only the markdown matrices (loaded once) feed an accessor, so they stay a dep.
  const columns: ColumnDef<ExpiryEntryItem>[] = useMemo(
    () => [
      {
        accessorKey: 'expiryDate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Expiry Date" />,
        cell: ({ row }) => <ExpiryDateCell item={row.original} />,
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
        id: 'daysToExpiry',
        // Computed column: give the table an accessorFn so sorting/filtering read
        // the derived day count instead of a non-existent `daysToExpiry` field.
        accessorFn: (row) => getDaysToExpiry(row.expiryDate) ?? Number.POSITIVE_INFINITY,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Days to Expiry" />,
        cell: ({ row }) => <DaysToExpiryCell item={row.original} />,
      },
      {
        id: 'status',
        // Computed column: the cell always shows the markdown status derived from the
        // expiry date, not the raw DB `status` field — so sort/filter on the same
        // derived value rather than the stored status (typically 'Normal').
        accessorFn: (row) => getMarkdownStatus(getDaysToExpiry(row.expiryDate)),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Markdown Status" />,
        cell: ({ row }) => <MarkdownStatusCell item={row.original} />,
      },
      {
        id: 'creditScope',
        header: 'Credit scope',
        cell: ({ row }) => (
          <MarkdownCreditScopeBadge
            creditScope={row.original.creditScope ?? 'NO_CREDIT'}
            creditScopeReason={row.original.creditScopeReason ?? 'NO_CREDIT'}
            creditSupplierId={row.original.creditSupplierId ?? null}
            creditSupplierName={row.original.creditSupplierName ?? null}
          />
        ),
      },
      {
        id: 'markdownPrice',
        // Computed column: derive the markdown price for sorting/filtering rather
        // than relying on a `markdownPrice` field that isn't on the data model.
        accessorFn: (row) => {
          const days = getDaysToExpiry(row.expiryDate);
          const matrix = markdownConfig.matrices?.[row.creditScope ?? 'NO_CREDIT'];
          if (!matrix) return null;
          return (
            calculateMarkdownPrice(
              { costPrice: row.costPrice, retailPrice: row.retailPrice },
              days,
              matrix,
            ) ?? row.costPrice
          );
        },
        header: ({ column }) => <DataTableColumnHeader column={column} title="Markdown Price" />,
        cell: ({ row }) => <MarkdownPriceCell item={row.original} />,
      },
      {
        accessorKey: 'locationName',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Location" />,
        cell: ({ row }) => <LocationCell item={row.original} />,
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
        cell: ({ row }) => <ActionsCell item={row.original} />,
      },
    ],
    [markdownConfig.matrices],
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
      <section className="space-y-6" aria-label="All expiry entries" aria-busy="true">
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
      </section>
    );
  }

  if (fetchError) {
    return (
      <section aria-label="All expiry entries">
        <div
          role="alert"
          className="rounded-lg border border-semantic-critical-muted bg-semantic-critical-muted p-6 text-center"
        >
          <p className="font-medium text-semantic-critical-muted-foreground">{fetchError}</p>
          <Button onClick={handleRetryFetch} variant="default" className="mt-4 min-h-11">
            Try again
          </Button>
        </div>
      </section>
    );
  }

  const hasData = reportData && reportData.length > 0;

  return (
    <section className="print-report-root space-y-6" aria-labelledby={PAGE_HEADING_ID}>
      <header className="mb-5">
        <div className="flex items-center justify-between">
          <h1 id={PAGE_HEADING_ID} className="font-heading text-2xl font-semibold">
            All Expiry Entries
          </h1>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
            className="no-print hidden min-h-11 md:inline-flex"
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
          </Button>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-semantic-text-secondary">
          Browse and sort every active expiry entry. Fix data-entry errors by editing an item&apos;s
          date or location{canDelete ? ', or delete entries that were logged in error.' : '.'}
        </p>
      </header>
      <MarkdownMatricesNotice {...markdownConfig} />

      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 rounded-lg border border-semantic-critical-muted bg-semantic-critical-muted py-1 pl-4 pr-1 text-sm text-semantic-critical-muted-foreground"
        >
          <span className="py-2">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss error"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-lg transition-colors hover:bg-semantic-surface-1 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-semantic-primary/50"
          >
            &times;
          </button>
        </div>
      )}

      {hasData && filteredData.length > MOBILE_SUMMARY_LIMIT ? (
        <p className="text-sm text-semantic-text-secondary md:hidden">
          Showing the first {MOBILE_SUMMARY_LIMIT} of {filteredData.length} entries. Use the table
          below to see and edit all of them.
        </p>
      ) : null}
      {hasData ? (
        <ul className="mb-5 space-y-3 md:hidden" aria-label="Expiry entry summary">
          {filteredData.slice(0, MOBILE_SUMMARY_LIMIT).map((item) => {
            const daysToExpiry = getDaysToExpiry(item.expiryDate);
            const matrix = markdownConfig.matrices?.[item.creditScope ?? 'NO_CREDIT'];
            const markdownPrice = matrix
              ? (calculateMarkdownPrice(
                  { costPrice: item.costPrice, retailPrice: item.retailPrice },
                  daysToExpiry,
                  matrix,
                ) ?? item.costPrice)
              : null;

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
                <div className="mt-2">
                  <MarkdownCreditScopeBadge
                    creditScope={item.creditScope ?? 'NO_CREDIT'}
                    creditScopeReason={item.creditScopeReason ?? 'NO_CREDIT'}
                    creditSupplierId={item.creditSupplierId ?? null}
                    creditSupplierName={item.creditSupplierName ?? null}
                  />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-semantic-text-secondary">Expiry</dt>
                    <dd className="font-medium tabular-nums">
                      {formatExpiryDate(item.expiryDate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-semantic-text-secondary">Markdown price</dt>
                    <dd className="font-medium tabular-nums">
                      {markdownPrice == null ? 'Unavailable' : formatCurrencyValue(markdownPrice)}
                    </dd>
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
            <h2 id={TABLE_HEADING_ID} tabIndex={-1} className="text-xl font-semibold outline-none">
              Expiry entries
            </h2>
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
                  className="min-h-11 w-[200px]"
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
                  <RowActionsContext.Provider value={rowActions}>
                    <DataTable
                      columns={columns}
                      data={filteredData}
                      filtering={true}
                      pagination={true}
                      sorting={true}
                    />
                  </RowActionsContext.Provider>
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
                          <td className="px-4 py-3 align-top">
                            {getMarkdownStatus(getDaysToExpiry(item.expiryDate))}
                          </td>
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
    </section>
  );
}
