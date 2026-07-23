import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import type { PolicyReviewItem, PolicyStatus, Supplier } from '../../types/supplierCredit';
import * as svc from '../../services/supplierCreditService';
import { ApiError } from '../../lib/api.service';
import { PolicyMarkdown } from './PolicyMarkdown';
import {
  SupplierPolicyFields,
  supplierPolicyDraft,
  supplierPolicyInput,
  type SupplierPolicyDraft,
} from './SupplierPolicyFields';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { validatePolicyWrite } from '@shared/supplier-policy';

const MAX_BULK_SELECTION = 500;

interface Props {
  suppliers: Supplier[];
  initialSupplierId?: number | null;
  isAdmin: boolean;
  getToken: () => Promise<string | null>;
  onChanged: () => void;
}

function formatPolicyDate(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date(value));
}

function actionErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 403) {
    return 'You no longer have permission to change supplier policy.';
  }
  return cause instanceof Error ? cause.message : 'Supplier policy action failed';
}

export const PolicyReviewPanel: React.FC<Props> = ({
  suppliers,
  initialSupplierId = null,
  isAdmin,
  getToken,
  onChanged,
}) => {
  const [items, setItems] = useState<PolicyReviewItem[]>([]);
  const [brandFilter, setBrandFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<PolicyStatus | ''>('');
  const [appliedFilters, setAppliedFilters] = useState<{
    brand?: string;
    supplier?: string;
    status?: PolicyStatus;
  }>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [supplierId, setSupplierId] = useState<number | null>(initialSupplierId);
  const [createdSupplier, setCreatedSupplier] = useState<Supplier | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDraft, setCreateDraft] = useState<SupplierPolicyDraft>(() => supplierPolicyDraft());
  const [createPreview, setCreatePreview] = useState(false);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string>>({});
  const [expandedBrandId, setExpandedBrandId] = useState<number | null>(null);
  const [clearSupplier, setClearSupplier] = useState<Supplier | null>(null);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [editDraft, setEditDraft] = useState<SupplierPolicyDraft>(() => supplierPolicyDraft());
  const [preview, setPreview] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const availableSuppliers = useMemo(
    () =>
      createdSupplier && !suppliers.some((supplier) => supplier.id === createdSupplier.id)
        ? [...suppliers, createdSupplier]
        : suppliers,
    [createdSupplier, suppliers],
  );
  const policySuppliers = useMemo(
    () => availableSuppliers.filter((supplier) => supplier.creditPolicyNote.trim().length > 0),
    [availableSuppliers],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await svc.getPolicyReview(await getToken(), appliedFilters));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load supplier policies');
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, getToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: kicks off the policy data fetch on deps change
    void load();
  }, [load]);

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setSelected(new Set());
    setAppliedFilters({
      ...(brandFilter.trim() ? { brand: brandFilter.trim() } : {}),
      ...(supplierFilter.trim() ? { supplier: supplierFilter.trim() } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    });
  };

  const toggleSelected = (brandId: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(brandId)) next.delete(brandId);
      else if (next.size < MAX_BULK_SELECTION) next.add(brandId);
      return next;
    });
  };

  const performAttach = async (targetSupplierId: number, token: string | null) => {
    const result = await svc.bulkAttachPolicy(
      { supplierId: targetSupplierId, brandIds: [...selected] },
      token,
    );
    setSummary(
      `Attached ${result.attached}, unchanged ${result.unchanged}, corrections ${result.corrections}`,
    );
    setSelected(new Set());
    await load();
    onChanged();
  };

  const attach = async () => {
    if (supplierId == null || selected.size === 0) return;
    setSaving(true);
    setError(null);
    setSummary(null);
    try {
      await performAttach(supplierId, await getToken());
    } catch (cause) {
      setError(actionErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const beginCreate = () => {
    setCreateName('');
    setCreateDraft(supplierPolicyDraft());
    setCreatePreview(false);
    setCreateFieldErrors({});
    setError(null);
    setCreateOpen(true);
  };

  const changeCreateDraft = (field: keyof SupplierPolicyDraft, value: string) => {
    setCreateDraft((current) => ({ ...current, [field]: value }));
    setCreateFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      if (field.startsWith('contact') || field === 'representativeEmail') delete next.contact;
      return next;
    });
  };

  const createAndAttach = async () => {
    const name = createName.trim();
    const input = supplierPolicyInput(createDraft, true);
    const validationErrors = validatePolicyWrite(input, null);
    const nextErrors = Object.fromEntries(
      validationErrors.map((item) => [item.field, item.message]),
    );
    if (!name) nextErrors.name = 'Supplier name is required';
    if (Object.keys(nextErrors).length > 0) {
      setCreateFieldErrors(nextErrors);
      return;
    }

    setSaving(true);
    setError(null);
    setSummary(null);
    let created: Supplier | null = null;
    try {
      const token = await getToken();
      created = await svc.createSupplier({ name, ...input }, token);
      setCreatedSupplier(created);
      setSupplierId(created.id);
      setCreateOpen(false);
      await performAttach(created.id, token);
    } catch (cause) {
      if (
        !created &&
        cause instanceof ApiError &&
        cause.status === 422 &&
        cause.errors.length > 0
      ) {
        setCreateFieldErrors(
          Object.fromEntries(cause.errors.map((item) => [item.field, item.message])),
        );
      } else {
        setError(actionErrorMessage(cause));
      }
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!clearSupplier) return;
    setSaving(true);
    setError(null);
    try {
      await svc.clearSupplierPolicy(clearSupplier.id, await getToken());
      setSummary(`Cleared policy for ${clearSupplier.name}`);
      setClearSupplier(null);
      await load();
      onChanged();
    } catch (cause) {
      setError(actionErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (supplier: Supplier) => {
    setEditSupplier(supplier);
    setEditDraft(supplierPolicyDraft(supplier));
    setPreview(false);
    setFieldErrors({});
    setError(null);
  };

  const changeEditDraft = (field: keyof SupplierPolicyDraft, value: string) => {
    setEditDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      if (field.startsWith('contact') || field === 'representativeEmail') delete next.contact;
      return next;
    });
  };

  const saveEdit = async () => {
    if (!editSupplier) return;
    const input = supplierPolicyInput(editDraft, true);
    const validationErrors = validatePolicyWrite(input, editSupplier);
    if (validationErrors.length > 0) {
      setFieldErrors(
        Object.fromEntries(validationErrors.map((item) => [item.field, item.message])),
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await svc.updateSupplier(editSupplier.id, input, await getToken());
      setSummary(`Updated policy for ${editSupplier.name}`);
      setEditSupplier(null);
      await load();
      onChanged();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 422 && cause.errors.length > 0) {
        setFieldErrors(Object.fromEntries(cause.errors.map((item) => [item.field, item.message])));
      } else {
        setError(actionErrorMessage(cause));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Supplier policy review" className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold font-heading">Supplier Policy Review</h2>
        <p className="text-sm text-semantic-text-secondary">
          Review the oldest or missing supplier policies first. The API order is preserved.
        </p>
      </div>

      <form
        className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end"
        onSubmit={applyFilters}
      >
        <div className="space-y-1">
          <Label htmlFor="policy-brand-filter">Brand</Label>
          <Input
            id="policy-brand-filter"
            aria-label="Filter by brand"
            value={brandFilter}
            onChange={(event) => setBrandFilter(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="policy-supplier-filter">Supplier</Label>
          <Input
            id="policy-supplier-filter"
            aria-label="Filter by supplier"
            value={supplierFilter}
            onChange={(event) => setSupplierFilter(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="policy-status-filter">Status</Label>
          <select
            id="policy-status-filter"
            aria-label="Filter by policy status"
            className="h-9 rounded-md border bg-semantic-surface-1 px-3 text-sm"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as PolicyStatus | '')}
          >
            <option value="">All</option>
            <option value="ATTACHED">Attached</option>
            <option value="MISSING">Missing</option>
          </select>
        </div>
        <Button type="submit" variant="outline">
          Apply filters
        </Button>
      </form>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bulk attach policy</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="bulk-policy-supplier">Policy supplier</Label>
              <select
                id="bulk-policy-supplier"
                aria-label="Policy supplier"
                className="h-9 min-w-52 rounded-md border bg-semantic-surface-1 px-3 text-sm"
                value={supplierId ?? ''}
                onChange={(event) =>
                  setSupplierId(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">Choose supplier</option>
                {availableSuppliers.map((supplier) => (
                  <option
                    key={supplier.id}
                    value={supplier.id}
                    disabled={!policySuppliers.some((candidate) => candidate.id === supplier.id)}
                  >
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" variant="outline" onClick={beginCreate} disabled={saving}>
              Create new supplier
            </Button>
            <Button
              onClick={() => void attach()}
              disabled={saving || supplierId == null || selected.size === 0}
            >
              Attach policy to {selected.size} {selected.size === 1 ? 'brand' : 'brands'}
            </Button>
            <p className="text-xs text-semantic-text-secondary">Maximum 500 brands per request.</p>
          </CardContent>
        </Card>
      )}

      {error && (
        <p role="alert" className="text-sm text-semantic-critical">
          {error}
        </p>
      )}
      {summary && (
        <p role="status" className="text-sm text-semantic-success">
          {summary}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {isAdmin && <TableHead className="w-12">Select</TableHead>}
              <TableHead>Brand</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Policy</TableHead>
              <TableHead>Last updated</TableHead>
              <TableHead>Representative</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const expanded = expandedBrandId === item.brandId;
              return (
                <React.Fragment key={item.brandId}>
                  <TableRow>
                    {isAdmin && (
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.brandName}`}
                          checked={selected.has(item.brandId)}
                          disabled={
                            !selected.has(item.brandId) && selected.size >= MAX_BULK_SELECTION
                          }
                          onChange={() => toggleSelected(item.brandId)}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">{item.brandName}</TableCell>
                    <TableCell>{item.supplier?.name ?? 'Unassigned'}</TableCell>
                    <TableCell>
                      <Badge variant={item.status === 'ATTACHED' ? 'success' : 'error'}>
                        {item.status === 'ATTACHED' ? 'Attached' : 'Missing'}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatPolicyDate(item.policyUpdatedAt)}</TableCell>
                    <TableCell>{item.representativeName ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {item.supplier?.creditPolicyNote.trim() && (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Hide' : 'Show'} policy for ${item.brandName}`}
                            onClick={() => setExpandedBrandId(expanded ? null : item.brandId)}
                          >
                            {expanded ? <ChevronDown /> : <ChevronRight />}
                            Policy
                          </Button>
                        )}
                        {isAdmin && item.supplier?.creditPolicyNote.trim() && (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Edit ${item.supplier.name} policy`}
                            onClick={() => beginEdit(item.supplier as Supplier)}
                          >
                            Edit
                          </Button>
                        )}
                        {isAdmin && item.supplier?.creditPolicyNote.trim() && (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Clear ${item.supplier.name} policy`}
                            onClick={() => setClearSupplier(item.supplier)}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded && item.supplier && (
                    <TableRow>
                      <TableCell colSpan={isAdmin ? 7 : 6}>
                        <PolicyMarkdown value={item.supplier.creditPolicyNote} />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={isAdmin ? 7 : 6}
                  className="py-10 text-center text-semantic-text-secondary"
                >
                  No supplier policies match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {loading && (
        <p role="status" className="text-sm text-semantic-text-secondary">
          Loading policies…
        </p>
      )}

      <AlertDialog
        open={clearSupplier != null}
        onOpenChange={(open) => !open && setClearSupplier(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear supplier policy?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears the instructions, ratio, and representative fields for{' '}
              {clearSupplier?.name}. Contact details are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void clear()} disabled={saving}>
              Clear policy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editSupplier != null} onOpenChange={(open) => !open && setEditSupplier(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit supplier policy · {editSupplier?.name}</DialogTitle>
          </DialogHeader>
          <SupplierPolicyFields
            value={editDraft}
            onChange={changeEditDraft}
            fieldErrors={fieldErrors}
            editableContacts
            editablePolicy
            preview={preview}
            onPreviewChange={setPreview}
            idPrefix="policy-review-edit"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSupplier(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} disabled={saving}>
              Save policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create supplier and attach policy</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="policy-review-create-name">Supplier name</Label>
            <Input
              id="policy-review-create-name"
              maxLength={120}
              value={createName}
              onChange={(event) => {
                setCreateName(event.target.value);
                setCreateFieldErrors((current) => ({ ...current, name: '' }));
              }}
            />
            {createFieldErrors.name && (
              <p className="mt-1 text-xs text-semantic-critical">{createFieldErrors.name}</p>
            )}
          </div>
          <SupplierPolicyFields
            value={createDraft}
            onChange={changeCreateDraft}
            fieldErrors={createFieldErrors}
            editableContacts
            editablePolicy
            preview={createPreview}
            onPreviewChange={setCreatePreview}
            idPrefix="policy-review-create"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void createAndAttach()} disabled={saving || selected.size === 0}>
              Create and attach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
