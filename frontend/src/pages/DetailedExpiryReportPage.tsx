import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { apiService } from '../lib/api.service';
import { calculateMarkdownPrice } from '../lib/utils';
import { DataTable } from '../components/ui/data-table';
import { DataTableColumnHeader } from '../components/ui/data-table-column-header';
import { ColumnDef } from '@tanstack/react-table';

interface DetailedExpiryReportPageProps {
  token: string | null;
}

interface DetailedExpiryReportItem {
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

export function DetailedExpiryReportPage({ token }: DetailedExpiryReportPageProps) {
  const [reportData, setReportData] = useState<DetailedExpiryReportItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<EditableInventoryItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<number | null>(null); // inventoryId to confirm deletion
  const [storeAreas, setStoreAreas] = useState<{ id: number; name: string }[]>([]);

  // Define columns for the data table
  const columns: ColumnDef<DetailedExpiryReportItem>[] = [
    {
      accessorKey: 'expiryDate',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Expiry Date" />,
      cell: ({ row }) => {
        // Check if this row is being edited
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
        } else {
          // Calculate days to expiry
          const expiryDate = new Date(row.original.expiryDate);
          const today = new Date();
          const daysToExpiry = Math.ceil(
            (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );

          return (
            <div
              className={`min-w-[140px] ${daysToExpiry <= 0 ? 'text-semantic-critical font-bold' : ''}`}
            >
              {new Date(row.original.expiryDate).toLocaleDateString()}
              <div className="text-xs text-semantic-text-tertiary">
                {daysToExpiry > 0 ? `${daysToExpiry} days left` : 'Expired'}
              </div>
            </div>
          );
        }
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
      cell: ({ row }) => <div className="min-w-[100px]">${row.original.costPrice.toFixed(2)}</div>,
    },
    {
      accessorKey: 'daysToExpiry',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Days to Expiry" />,
      cell: ({ row }) => {
        // Check if this row is being edited
        const isEditing = editingItem && editingItem.inventoryId === row.original.inventoryId;

        if (isEditing) {
          // Calculate days to expiry based on the editing date
          const editingExpiryDate = new Date(editingItem.expiryDate);
          const today = new Date();
          const editingDaysToExpiry = Math.ceil(
            (editingExpiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );

          return <div className="min-w-[100px]">{editingDaysToExpiry}</div>;
        } else {
          // Calculate days to expiry
          const expiryDate = new Date(row.original.expiryDate);
          const today = new Date();
          const daysToExpiry = Math.ceil(
            (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );

          return <div className="min-w-[100px]">{daysToExpiry}</div>;
        }
      },
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Markdown Status" />,
      cell: ({ row }) => {
        // Check if this row is being edited
        const isEditing = editingItem && editingItem.inventoryId === row.original.inventoryId;

        if (isEditing) {
          // Calculate days to expiry based on the editing date
          const editingExpiryDate = new Date(editingItem.expiryDate);
          const today = new Date();
          const editingDaysToExpiry = Math.ceil(
            (editingExpiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );

          // Determine markdown status based on editing days to expiry
          let editingMarkdownStatus = 'Normal (>90 days)';
          if (editingDaysToExpiry <= 0) {
            editingMarkdownStatus = 'Expired (<=0 days)';
          } else if (editingDaysToExpiry <= 30) {
            editingMarkdownStatus = 'Markdown 3 (<30 days)';
          } else if (editingDaysToExpiry <= 60) {
            editingMarkdownStatus = 'Markdown 2 (<60 & >30 days)';
          } else if (editingDaysToExpiry <= 90) {
            editingMarkdownStatus = 'Markdown 1 (<90 & >60 days)';
          }

          return (
            <div className="min-w-[140px] max-w-[160px] truncate" title={editingMarkdownStatus}>
              {editingMarkdownStatus}
            </div>
          );
        } else {
          // Calculate days to expiry
          const expiryDate = new Date(row.original.expiryDate);
          const today = new Date();
          const daysToExpiry = Math.ceil(
            (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );

          // Determine markdown status based on days to expiry
          let markdownStatus = 'Normal (>90 days)';
          if (daysToExpiry <= 0) {
            markdownStatus = 'Expired (<=0 days)';
          } else if (daysToExpiry <= 30) {
            markdownStatus = 'Markdown 3 (<30 days)';
          } else if (daysToExpiry <= 60) {
            markdownStatus = 'Markdown 2 (<60 & >30 days)';
          } else if (daysToExpiry <= 90) {
            markdownStatus = 'Markdown 1 (<90 & >60 days)';
          }

          return (
            <div className="min-w-[140px] max-w-[160px] truncate" title={markdownStatus}>
              {markdownStatus}
            </div>
          );
        }
      },
    },
    {
      accessorKey: 'markdownPrice',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Markdown Price" />,
      cell: ({ row }) => {
        // Check if this row is being edited
        const isEditing = editingItem && editingItem.inventoryId === row.original.inventoryId;

        if (isEditing) {
          // Calculate days to expiry based on the editing date
          const editingExpiryDate = new Date(editingItem.expiryDate);
          const today = new Date();
          const editingDaysToExpiry = Math.ceil(
            (editingExpiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );

          // Calculate markdown price based on editing days to expiry
          const editingMarkdownPrice = calculateMarkdownPrice(
            row.original.costPrice,
            editingDaysToExpiry,
          );

          return <div className="min-w-[100px]">${editingMarkdownPrice.toFixed(2)}</div>;
        } else {
          // Calculate days to expiry
          const expiryDate = new Date(row.original.expiryDate);
          const today = new Date();
          const daysToExpiry = Math.ceil(
            (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
          );

          // Calculate markdown price based on days to expiry
          const markdownPrice = calculateMarkdownPrice(row.original.costPrice, daysToExpiry);

          return <div className="min-w-[100px]">${markdownPrice.toFixed(2)}</div>;
        }
      },
    },
    {
      accessorKey: 'locationName',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Location" />,
      cell: ({ row }) => {
        // Check if this row is being edited
        const isEditing = editingItem && editingItem.inventoryId === row.original.inventoryId;

        if (isEditing) {
          return (
            <div className="min-w-[120px]">
              <select
                value={editingItem.locationId}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    locationId: parseInt(e.target.value),
                  })
                }
                disabled={saving}
                className="border rounded p-1 w-full"
              >
                {storeAreas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            </div>
          );
        } else {
          return (
            <div className="min-w-[120px] max-w-[160px] truncate" title={row.original.locationName}>
              {row.original.locationName}
            </div>
          );
        }
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
        // Check if this row is pending deletion
        if (deleteConfirmation === row.original.inventoryId) {
          return (
            <div className="flex gap-2 justify-start min-w-[140px]">
              <Button
                onClick={() => handleDelete(row.original.inventoryId)}
                size="sm"
                className="bg-semantic-critical hover:bg-semantic-critical-hover text-white text-xs flex-shrink-0 min-w-[70px]"
              >
                Confirm Delete
              </Button>
              <Button
                onClick={cancelDelete}
                size="sm"
                className="bg-semantic-surface-4 hover:bg-semantic-text-tertiary text-white text-xs flex-shrink-0 min-w-[60px]"
              >
                Cancel
              </Button>
            </div>
          );
        }

        // Check if this row is being edited
        const isEditing = editingItem && editingItem.inventoryId === row.original.inventoryId;

        if (isEditing) {
          return (
            <div className="flex gap-2 justify-start min-w-[140px]">
              <Button
                onClick={handleSaveEdit}
                disabled={saving}
                size="sm"
                variant="default"
                className="min-w-[50px] bg-semantic-success hover:bg-semantic-success-hover text-white font-medium disabled:bg-semantic-surface-4"
              >
                {saving ? '...' : 'Save'}
              </Button>
              <Button
                onClick={handleCancelEdit}
                disabled={saving}
                size="sm"
                variant="secondary"
                className="min-w-[50px] bg-semantic-surface-4 hover:bg-semantic-text-tertiary text-white font-medium"
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
              size="sm"
              variant="default"
              className="min-w-[50px] bg-semantic-primary hover:bg-semantic-primary-hover text-white font-medium"
            >
              Edit
            </Button>
            <Button
              onClick={() => confirmDelete(row.original.inventoryId)}
              size="sm"
              variant="destructive"
              className="min-w-[50px] bg-semantic-critical hover:bg-semantic-critical-hover text-white font-medium"
            >
              Delete
            </Button>
          </div>
        );
      },
    },
  ];

  useEffect(() => {
    const fetchReportData = async () => {
      if (!token) {
        setError('Authentication token is missing.');
        setLoading(false);
        return;
      }

      try {
        const data = await apiService.get<DetailedExpiryReportItem[]>(
          '/reports/expiry-details',
          token,
        );
        setReportData(data);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchReportData();
  }, [token]);

  useEffect(() => {
    if (!token) return;

    const fetchStoreAreas = async () => {
      try {
        const data = await apiService.get<{ id: number; name: string }[]>('/store-areas', token);
        setStoreAreas(data);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unknown error occurred when fetching store areas');
        }
      }
    };

    fetchStoreAreas();
  }, [token]);

  if (loading) {
    return (
      <div className="container mx-auto p-4 text-center">Loading detailed expiry report...</div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-4 text-center text-semantic-critical">Error: {error}</div>
    );
  }

  const handleEdit = async (item: DetailedExpiryReportItem) => {
    // If there's a currently editing item, save it first
    if (editingItem && editingItem.inventoryId !== item.inventoryId) {
      await handleSaveEdit();
    }

    setEditingItem({
      inventoryId: item.inventoryId,
      expiryDate: item.expiryDate,
      locationId: item.locationId,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return; // Only require editingItem, not token for internal calls

    if (!token) {
      setError('Authentication token is missing.');
      return;
    }

    setSaving(true);
    try {
      await apiService.put(
        `/inventory-items/${editingItem.inventoryId}`,
        {
          expiryDate: editingItem.expiryDate,
          locationId: editingItem.locationId,
        },
        token,
      );

      // Refresh the report data
      const updatedData = await apiService.get<DetailedExpiryReportItem[]>(
        '/reports/expiry-details',
        token,
      );
      setReportData(updatedData);
      setEditingItem(null);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred while updating the item');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingItem(null);
  };

  const handleDelete = async (inventoryId: number) => {
    if (!token) {
      setError('Authentication token is missing.');
      return;
    }

    try {
      await apiService.delete(`/inventory-items/${inventoryId}`, token);

      // Refresh the report data
      const updatedData = await apiService.get<DetailedExpiryReportItem[]>(
        '/reports/expiry-details',
        token,
      );
      setReportData(updatedData);
      setDeleteConfirmation(null);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unknown error occurred while deleting the item');
      }
    }
  };

  const confirmDelete = (inventoryId: number) => {
    setDeleteConfirmation(inventoryId);
  };

  const cancelDelete = () => {
    setDeleteConfirmation(null);
  };

  return (
    <div className="container mx-auto p-4 overflow-x-auto">
      <div className="overflow-x-auto">
        {/* Original Table Section */}
        <Card className="overflow-visible">
          <CardHeader>
            <CardTitle className="text-center">Detailed Expiry Report (Next 90 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {reportData && reportData.length > 0 ? (
              <DataTable
                columns={columns}
                data={reportData}
                filtering={true}
                pagination={true}
                sorting={true}
              />
            ) : (
              <p className="text-center">No expiry items found in the next 90 days.</p>
            )}
            {/* Mobile notification */}
            <div className="mt-6 p-3 bg-semantic-warning-muted border border-semantic-warning-muted rounded-lg text-center text-sm text-semantic-warning-muted-foreground md:hidden">
              <p>
                <strong>Note:</strong> This report is best viewed on a desktop device. For better
                mobile experience, use the Scan Page or Markdown Calculator.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
