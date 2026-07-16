import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import type { BrandReviewItem, Supplier } from '../../types/supplierCredit';
import * as svc from '../../services/supplierCreditService';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Label } from '../ui/label';
import { ApiError } from '../../lib/api.service';

const MAX_BULK_SELECTION = 500;

interface Props {
  suppliers: Supplier[];
  getToken: () => Promise<string | null>;
  onChanged: () => void;
}

export const CatalogueReviewPanel: React.FC<Props> = ({ suppliers, getToken, onChanged }) => {
  const [mode, setMode] = useState<'BRAND_REVIEW' | 'SKU_MATCHING'>('BRAND_REVIEW');
  const [items, setItems] = useState<BrandReviewItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'NEEDS_BRAND'>('ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brandNames, setBrandNames] = useState<Record<number, string>>({});
  const [supplierIds, setSupplierIds] = useState<Record<number, number>>({});

  const loadPage = useCallback(
    async (cursor?: number) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const page = await svc.getBrandReview(token, {
          ...(filter === 'NEEDS_BRAND' ? { state: 'NEEDS_BRAND' } : {}),
          ...(cursor == null ? {} : { cursor }),
          limit: 50,
        });
        setItems((current) => (cursor == null ? page.items : [...current, ...page.items]));
        setNextCursor(page.nextCursor);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to load catalogue review');
      } finally {
        setLoading(false);
      }
    },
    [filter, getToken],
  );

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const groups = useMemo(() => {
    const grouped = new Map<string, BrandReviewItem[]>();
    for (const item of items) {
      const label =
        item.brand?.suggestedSupplierName || (item.brand ? 'Other matched brands' : 'Needs brand');
      grouped.set(label, [...(grouped.get(label) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [items]);

  const confirm = async (item: BrandReviewItem) => {
    if (!item.brand) return;
    const supplierId = supplierIds[item.productId] ?? suppliers[0]?.id;
    if (supplierId == null) {
      setError('Create a supplier before confirming this brand.');
      return;
    }
    await svc.confirmBrandSupplier(item.brand.id, supplierId, await getToken());
    await loadPage();
    onChanged();
  };

  const add = async (item: BrandReviewItem) => {
    const name = brandNames[item.productId]?.trim();
    if (!name) {
      setError('Enter a brand name.');
      return;
    }
    await svc.addBrand(
      {
        productId: item.productId,
        name,
        supplierId: supplierIds[item.productId] ?? null,
      },
      await getToken(),
    );
    await loadPage();
    onChanged();
  };

  if (mode === 'SKU_MATCHING') {
    return (
      <section aria-label="Catalogue SKU matching" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold font-heading">Catalogue Review</h2>
            <p className="text-sm text-semantic-text-secondary">
              Match unmatched SKUs in one atomic brand-link operation.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setMode('BRAND_REVIEW')}>
              Brand setup
            </Button>
            <Button size="sm">SKU matching</Button>
          </div>
        </div>
        <SkuMatchingView
          items={items}
          suppliers={suppliers}
          loading={loading}
          getToken={getToken}
          onLinked={async () => {
            await loadPage();
            onChanged();
          }}
        />
      </section>
    );
  }

  return (
    <section aria-label="Catalogue brand review" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold font-heading">Catalogue Review</h2>
          <p className="text-sm text-semantic-text-secondary">
            Confirm reference matches or add the missing brand. Supplier policy can be completed
            later.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm">Brand setup</Button>
          <Button variant="outline" size="sm" onClick={() => setMode('SKU_MATCHING')}>
            SKU matching
          </Button>
          <Button
            variant={filter === 'ALL' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('ALL')}
          >
            All matches
          </Button>
          <Button
            variant={filter === 'NEEDS_BRAND' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('NEEDS_BRAND')}
          >
            Needs brand
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-semantic-critical">{error}</p>}
      {!loading && groups.length === 0 && (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-semantic-text-secondary">
          No products in this review bucket.
        </div>
      )}
      {groups.map(([label, groupItems]) => (
        <Card key={label}>
          <CardHeader>
            <CardTitle className="text-lg">{label}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {groupItems.map((item) => (
                <li
                  key={item.productId}
                  className="grid gap-3 py-3 md:grid-cols-[1fr_auto] md:items-center"
                >
                  <div>
                    <p className="font-medium">
                      {item.productName}{' '}
                      <span className="font-mono text-sm text-semantic-text-secondary">
                        {item.sku}
                      </span>
                    </p>
                    {item.brand ? (
                      <p className="mt-1 text-sm text-semantic-text-secondary">
                        {item.brand.name}{' '}
                        {item.brand.source === 'REFERENCE' && (
                          <Badge className="ml-1">Pending confirmation</Badge>
                        )}
                      </p>
                    ) : (
                      <Input
                        aria-label={`Brand name for ${item.productName}`}
                        className="mt-2 max-w-xs"
                        value={brandNames[item.productId] ?? ''}
                        onChange={(event) =>
                          setBrandNames((value) => ({
                            ...value,
                            [item.productId]: event.target.value,
                          }))
                        }
                        placeholder="Brand name"
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {suppliers.length > 0 && (
                      <select
                        aria-label={`Supplier for ${item.productName}`}
                        className="rounded-md border px-3 py-2 text-sm"
                        value={supplierIds[item.productId] ?? suppliers[0].id}
                        onChange={(event) =>
                          setSupplierIds((value) => ({
                            ...value,
                            [item.productId]: Number(event.target.value),
                          }))
                        }
                      >
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <Button size="sm" onClick={() => void (item.brand ? confirm(item) : add(item))}>
                      {item.brand ? 'Complete setup' : 'Add brand'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      {nextCursor != null && (
        <Button variant="outline" onClick={() => void loadPage(nextCursor)} disabled={loading}>
          Load more
        </Button>
      )}
      {loading && (
        <p role="status" className="text-sm text-semantic-text-secondary">
          Loading catalogue…
        </p>
      )}
    </section>
  );
};

const SkuMatchingView: React.FC<{
  items: BrandReviewItem[];
  suppliers: Supplier[];
  loading: boolean;
  getToken: () => Promise<string | null>;
  onLinked: () => Promise<void>;
}> = ({ items, suppliers, loading, getToken, onLinked }) => {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [brandId, setBrandId] = useState<number | null>(null);
  const [brandName, setBrandName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const suppliersById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  );
  const brands = useMemo(() => {
    const unique = new Map<number, { id: number; name: string }>();
    for (const item of items) {
      if (item.brand) unique.set(item.brand.id, { id: item.brand.id, name: item.brand.name });
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);
  const groups = useMemo(() => {
    const grouped = new Map<string, BrandReviewItem[]>();
    for (const item of items) {
      const label = item.brand?.name ?? 'Unmatched';
      grouped.set(label, [...(grouped.get(label) ?? []), item]);
    }
    return [...grouped.entries()].sort(([a], [b]) => {
      if (a === 'Unmatched') return -1;
      if (b === 'Unmatched') return 1;
      return a.localeCompare(b);
    });
  }, [items]);

  const toggle = (productId: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else if (next.size < MAX_BULK_SELECTION) next.add(productId);
      return next;
    });
  };

  const selectFirstUnmatched = () => {
    setSelected(
      new Set(
        items
          .filter((item) => item.brand == null)
          .slice(0, MAX_BULK_SELECTION)
          .map((item) => item.productId),
      ),
    );
  };

  const link = async () => {
    const trimmedName = brandName.trim();
    if (selected.size === 0 || (brandId == null && !trimmedName)) return;
    setSaving(true);
    setError(null);
    setSummary(null);
    try {
      const result = await svc.bulkLinkProducts(
        brandId != null
          ? { brandId, productIds: [...selected] }
          : { brandName: trimmedName, productIds: [...selected] },
        await getToken(),
      );
      setSummary(
        `Linked ${result.linked}, already linked ${result.alreadyLinked}, corrections ${result.corrections}`,
      );
      setSelected(new Set());
      await onLinked();
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? 'Nothing was linked because one or more SKUs already belong to another brand.'
          : cause instanceof Error
            ? cause.message
            : 'Failed to link selected SKUs',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <Button variant="outline" onClick={selectFirstUnmatched} disabled={loading}>
            Select first 500 unmatched SKUs
          </Button>
          <p className="text-sm text-semantic-text-secondary">{selected.size} of 500 selected</p>
          <div className="space-y-1">
            <Label htmlFor="bulk-existing-brand">Existing brand</Label>
            <select
              id="bulk-existing-brand"
              className="h-9 min-w-48 rounded-md border bg-semantic-surface-1 px-3 text-sm"
              value={brandId ?? ''}
              onChange={(event) => {
                setBrandId(event.target.value ? Number(event.target.value) : null);
                if (event.target.value) setBrandName('');
              }}
            >
              <option value="">Choose existing brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bulk-new-brand">New brand name</Label>
            <Input
              id="bulk-new-brand"
              aria-label="New brand name"
              value={brandName}
              onChange={(event) => {
                setBrandName(event.target.value);
                if (event.target.value) setBrandId(null);
              }}
            />
          </div>
          <Button
            onClick={() => void link()}
            disabled={saving || selected.size === 0 || (brandId == null && !brandName.trim())}
          >
            Link {selected.size} SKUs
          </Button>
        </CardContent>
      </Card>
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
      {groups.map(([label, groupItems]) => (
        <Card key={label}>
          <CardHeader>
            <CardTitle className="text-base">
              {label} · {groupItems.length} {groupItems.length === 1 ? 'SKU' : 'SKUs'}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Select</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Supplier policy</TableHead>
                  <TableHead>Last updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupItems.map((item) => {
                  const supplier =
                    item.brand?.supplierId == null
                      ? null
                      : (suppliersById.get(item.brand.supplierId) ?? null);
                  const hasPolicy = Boolean(supplier?.creditPolicyNote.trim());
                  const unmatched = item.brand == null;
                  return (
                    <TableRow
                      key={item.productId}
                      className={unmatched ? 'bg-semantic-critical-muted' : undefined}
                    >
                      <TableCell>
                        {unmatched && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${item.productName}`}
                            checked={selected.has(item.productId)}
                            disabled={
                              !selected.has(item.productId) && selected.size >= MAX_BULK_SELECTION
                            }
                            onChange={() => toggle(item.productId)}
                          />
                        )}
                      </TableCell>
                      <TableCell className="font-mono">{item.sku}</TableCell>
                      <TableCell>{item.productName}</TableCell>
                      <TableCell>
                        {item.brand?.name ?? <Badge variant="error">Unmatched</Badge>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={hasPolicy ? 'success' : 'error'}>
                          {hasPolicy ? 'Attached' : 'Missing'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {supplier?.policyUpdatedAt
                          ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(
                              new Date(supplier.policyUpdatedAt),
                            )
                          : 'Never'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
      {!loading && groups.length === 0 && (
        <p className="text-sm text-semantic-text-secondary">No catalogue SKUs found.</p>
      )}
    </div>
  );
};
