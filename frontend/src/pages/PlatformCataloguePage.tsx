import React, { useCallback, useEffect, useState } from 'react';
import {
  getCatalogueProvenance,
  getPendingCatalogueCorrections,
  reviewCatalogueCorrection,
} from '../services/platformCatalogueService';
import type {
  CatalogueProvenanceResponse,
  PlatformCatalogueCorrection,
} from '../types/platformCatalogue';

interface PlatformCataloguePageProps {
  token: string | null;
}

function age(createdAt: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));
  return days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function PlatformCataloguePage({ token }: PlatformCataloguePageProps) {
  const [provenance, setProvenance] = useState<CatalogueProvenanceResponse | null>(null);
  const [corrections, setCorrections] = useState<PlatformCatalogueCorrection[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextProvenance, queue] = await Promise.all([
        getCatalogueProvenance(token),
        getPendingCatalogueCorrections(token),
      ]);
      setProvenance(nextProvenance);
      setCorrections(queue.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load catalogue triage');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  const runActions = async (
    ids: number[],
    status: 'ACCEPTED' | 'REJECTED',
    requireConfirmation: boolean,
  ) => {
    if (ids.length === 0) return;
    if (
      requireConfirmation &&
      !window.confirm(
        `${status === 'REJECTED' ? 'Reject' : 'Accept'} ${ids.length} selected correction${ids.length === 1 ? '' : 's'}?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setActionError(null);
    const results = await Promise.allSettled(
      ids.map((id) => reviewCatalogueCorrection(id, status, token)),
    );
    const failed = new Set(ids.filter((_id, index) => results[index].status === 'rejected'));
    setSelected(failed);
    if (failed.size > 0) {
      setActionError(
        `${failed.size} correction${failed.size === 1 ? '' : 's'} failed; successful actions were saved.`,
      );
    }
    await load();
    setBusy(false);
  };

  if (loading) {
    return <p role="status">Loading platform catalogue…</p>;
  }
  if (error) {
    return (
      <section className="space-y-3">
        <p role="alert">{error}</p>
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </section>
    );
  }

  const latest = provenance?.latest;
  const allSelected = corrections.length > 0 && corrections.every((item) => selected.has(item.id));

  return (
    <div className="space-y-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          Platform operations
        </p>
        <h1 className="text-3xl font-bold">Catalogue provenance and triage</h1>
      </header>

      <section aria-labelledby="provenance-heading" className="rounded-lg border p-5">
        <h2 id="provenance-heading" className="text-xl font-semibold">
          Seed provenance
        </h2>
        {!latest ? (
          <p>No catalogue seed runs have been recorded.</p>
        ) : (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div>
                <strong>Version {latest.version}</strong>
                <div>{latest.sourceFileName}</div>
                <time dateTime={latest.seededAt}>{new Date(latest.seededAt).toLocaleString()}</time>
              </div>
              <dl className="grid grid-cols-2 gap-x-4">
                <div>
                  <dt>Inserted</dt>
                  <dd>{latest.inserted}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{latest.updated}</dd>
                </div>
                <div>
                  <dt>Unchanged</dt>
                  <dd>{latest.unchanged}</dd>
                </div>
                <div>
                  <dt>Reinstated</dt>
                  <dd>{latest.reinstated}</dd>
                </div>
                <div>
                  <dt>Errors</dt>
                  <dd>{latest.errorCount}</dd>
                </div>
              </dl>
              <div
                className={
                  latest.retired > 0
                    ? 'rounded-md border border-amber-500 bg-amber-50 p-3 text-amber-950'
                    : ''
                }
              >
                {latest.retired > 0
                  ? `${latest.retired} entries retired in this seed`
                  : 'No entries retired'}
              </div>
            </div>
            <h3 className="mt-5 font-semibold">Prior runs</h3>
            {provenance.history.length === 0 ? (
              <p>No prior runs.</p>
            ) : (
              <ul>
                {provenance.history.map((run) => (
                  <li key={run.id}>
                    Version {run.version} · {run.sourceFileName} · {run.retired} retired
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="corrections-heading" className="rounded-lg border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="corrections-heading" className="text-xl font-semibold">
            Pending corrections
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={() => void runActions([...selected], 'ACCEPTED', true)}
            >
              Accept selected
            </button>
            <button
              type="button"
              disabled={busy || selected.size === 0}
              onClick={() => void runActions([...selected], 'REJECTED', true)}
            >
              Reject selected
            </button>
          </div>
        </div>
        {actionError && <p role="alert">{actionError}</p>}
        {corrections.length === 0 ? (
          <p>No pending catalogue corrections.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all corrections"
                      checked={allSelected}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? new Set(corrections.map((item) => item.id))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th>Kind</th>
                  <th>Barcode</th>
                  <th>Entered brand</th>
                  <th>Supplier</th>
                  <th>Organization</th>
                  <th>Age</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {corrections.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select correction ${item.id}`}
                        checked={selected.has(item.id)}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td>{item.kind}</td>
                    <td>{item.barcode ?? '—'}</td>
                    <td>{item.enteredBrandName ?? '—'}</td>
                    <td>{item.chosenSupplier?.name ?? '—'}</td>
                    <td>{item.organization.name}</td>
                    <td>{age(item.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runActions([item.id], 'ACCEPTED', false)}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runActions([item.id], 'REJECTED', true)}
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
