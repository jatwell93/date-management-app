import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import type { BrandReviewItem, Supplier } from '../../types/supplierCredit';
import * as svc from '../../services/supplierCreditService';

interface Props {
  suppliers: Supplier[];
  getToken: () => Promise<string | null>;
  onChanged: () => void;
}

export const CatalogueReviewPanel: React.FC<Props> = ({ suppliers, getToken, onChanged }) => {
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
