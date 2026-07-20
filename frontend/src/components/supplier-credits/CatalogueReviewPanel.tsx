import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import type {
  BrandReviewItem,
  CatalogueTitleMatch,
  CatalogueTitleSort,
  Supplier,
} from '../../types/supplierCredit';
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
  const [filter, setFilter] = useState<'ALL' | 'NEEDS_BRAND'>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [titleDraft, setTitleDraft] = useState('');
  const [title, setTitle] = useState('');
  const [titleMatch, setTitleMatch] = useState<CatalogueTitleMatch>('contains');
  const [sort, setSort] = useState<CatalogueTitleSort>('titleAsc');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brandNames, setBrandNames] = useState<Record<number, string>>({});
  const [supplierIds, setSupplierIds] = useState<Record<number, number>>({});

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const page = await svc.getBrandReview(token, {
        ...(filter === 'NEEDS_BRAND' ? { state: 'NEEDS_BRAND' } : {}),
        page: currentPage,
        pageSize,
        ...(title ? { title } : {}),
        titleMatch,
        sort,
      });
      setItems(page.items);
      setTotalItems(page.totalItems ?? page.items.length);
      setTotalPages(page.totalPages ?? (page.items.length > 0 ? 1 : 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load catalogue review');
    } finally {
      setLoading(false);
    }
  }, [currentPage, filter, getToken, pageSize, sort, title, titleMatch]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: kicks off the page data fetch on deps change
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

  const changeFilter = (nextFilter: 'ALL' | 'NEEDS_BRAND') => {
    setFilter(nextFilter);
    setCurrentPage(1);
  };

  const applyTitle = (event: React.FormEvent) => {
    event.preventDefault();
    setTitle(titleDraft.trim());
    setCurrentPage(1);
  };

  const controls = (
    <CatalogueControls
      titleDraft={titleDraft}
      titleMatch={titleMatch}
      sort={sort}
      pageSize={pageSize}
      onTitleDraftChange={setTitleDraft}
      onSubmit={applyTitle}
      onTitleMatchChange={(value) => {
        setTitleMatch(value);
        setCurrentPage(1);
      }}
      onSortChange={(value) => {
        setSort(value);
        setCurrentPage(1);
      }}
      onPageSizeChange={(value) => {
        setPageSize(value);
        setCurrentPage(1);
      }}
    />
  );

  const pagination = (
    <CataloguePagination
      currentPage={currentPage}
      pageSize={pageSize}
      totalItems={totalItems}
      totalPages={totalPages}
      loading={loading}
      onPageChange={setCurrentPage}
    />
  );

  const confirm = async (item: BrandReviewItem) => {
    if (!item.brand) return;
    const supplierId = supplierIds[item.productId] ?? item.brand.supplierId ?? suppliers[0]?.id;
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
        {controls}
        <SkuMatchingView
          items={items}
          suppliers={suppliers}
          loading={loading}
          selectionResetKey={`${filter}|${title}|${titleMatch}|${sort}|${pageSize}`}
          getToken={getToken}
          onLinked={async () => {
            await loadPage();
            onChanged();
          }}
        />
        {pagination}
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
            onClick={() => changeFilter('ALL')}
          >
            All matches
          </Button>
          <Button
            variant={filter === 'NEEDS_BRAND' ? 'default' : 'outline'}
            size="sm"
            onClick={() => changeFilter('NEEDS_BRAND')}
          >
            Needs brand
          </Button>
        </div>
      </div>
      {controls}
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
                        className="rounded-md border px-3 py-2 text-sm outline-none focus-visible:border-semantic-primary focus-visible:ring-[3px] focus-visible:ring-semantic-primary/50"
                        value={
                          supplierIds[item.productId] ?? item.brand?.supplierId ?? suppliers[0].id
                        }
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
      {pagination}
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
  selectionResetKey: string;
  getToken: () => Promise<string | null>;
  onLinked: () => Promise<void>;
}> = ({ items, suppliers, loading, selectionResetKey, getToken, onLinked }) => {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [brandId, setBrandId] = useState<number | null>(null);
  const [brandName, setBrandName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clears selection when the parent-provided reset key changes
    setSelected(new Set());
  }, [selectionResetKey]);

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

interface CatalogueControlsProps {
  titleDraft: string;
  titleMatch: CatalogueTitleMatch;
  sort: CatalogueTitleSort;
  pageSize: number;
  onTitleDraftChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onTitleMatchChange: (value: CatalogueTitleMatch) => void;
  onSortChange: (value: CatalogueTitleSort) => void;
  onPageSizeChange: (value: number) => void;
}

const CatalogueControls: React.FC<CatalogueControlsProps> = ({
  titleDraft,
  titleMatch,
  sort,
  pageSize,
  onTitleDraftChange,
  onSubmit,
  onTitleMatchChange,
  onSortChange,
  onPageSizeChange,
}) => (
  <form
    className="flex flex-wrap items-end gap-3 rounded-lg border bg-semantic-surface-1 p-3"
    onSubmit={onSubmit}
  >
    <div className="min-w-48 flex-1 space-y-1">
      <Label htmlFor="catalogue-title-filter">Product title</Label>
      <Input
        id="catalogue-title-filter"
        aria-label="Filter product titles"
        value={titleDraft}
        onChange={(event) => onTitleDraftChange(event.target.value)}
        placeholder="Filter by title"
      />
    </div>
    <div className="space-y-1">
      <Label htmlFor="catalogue-title-match">Match</Label>
      <select
        id="catalogue-title-match"
        aria-label="Title match"
        className="h-9 rounded-md border bg-semantic-surface-1 px-3 text-sm"
        value={titleMatch}
        onChange={(event) => onTitleMatchChange(event.target.value as CatalogueTitleMatch)}
      >
        <option value="contains">Contains</option>
        <option value="startsWith">Starts with</option>
      </select>
    </div>
    <div className="space-y-1">
      <Label htmlFor="catalogue-title-order">Order</Label>
      <select
        id="catalogue-title-order"
        aria-label="Title order"
        className="h-9 rounded-md border bg-semantic-surface-1 px-3 text-sm"
        value={sort}
        onChange={(event) => onSortChange(event.target.value as CatalogueTitleSort)}
      >
        <option value="titleAsc">A–Z</option>
        <option value="titleDesc">Z–A</option>
      </select>
    </div>
    <div className="space-y-1">
      <Label htmlFor="catalogue-page-size">Rows</Label>
      <select
        id="catalogue-page-size"
        aria-label="Rows per page"
        className="h-9 rounded-md border bg-semantic-surface-1 px-3 text-sm"
        value={pageSize}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
      >
        {[25, 50, 100].map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
    </div>
    <Button type="submit" variant="outline">
      Apply title filter
    </Button>
  </form>
);

interface CataloguePaginationProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}

const CataloguePagination: React.FC<CataloguePaginationProps> = ({
  currentPage,
  pageSize,
  totalItems,
  totalPages,
  loading,
  onPageChange,
}) => {
  const firstItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);
  const firstVisiblePage = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const visiblePages = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => firstVisiblePage + index,
  );

  return (
    <nav
      aria-label="Catalogue pagination"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm tabular-nums text-semantic-text-secondary">
        {firstItem}–{lastItem} of {totalItems}
      </p>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="outline"
          size="sm"
          aria-label="First page"
          disabled={loading || currentPage <= 1}
          onClick={() => onPageChange(1)}
        >
          First
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous page"
          disabled={loading || currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </Button>
        {visiblePages.map((page) => (
          <Button
            key={page}
            variant={page === currentPage ? 'default' : 'outline'}
            size="sm"
            aria-label={`Page ${page}`}
            aria-current={page === currentPage ? 'page' : undefined}
            disabled={loading}
            onClick={() => onPageChange(page)}
          >
            {page}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          aria-label="Next page"
          disabled={loading || currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Last page"
          disabled={loading || currentPage >= totalPages}
          onClick={() => onPageChange(totalPages)}
        >
          Last
        </Button>
      </div>
    </nav>
  );
};
