import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCatalogueProvenance,
  getPendingCatalogueCorrections,
  reviewCatalogueCorrection,
} from '../services/platformCatalogueService';
import type {
  CatalogueProvenanceResponse,
  PlatformCatalogueCorrection,
} from '../types/platformCatalogue';
import { Button } from '../components/ui/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

interface PlatformCataloguePageProps {
  token: string | null;
}

function age(createdAt: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000));
  return days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} ago`;
}

const SEEDED_AT_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** `BRAND_ADDED` -> `Brand added`; the API sends enum names. */
function humanizeKind(kind: string): string {
  const words = kind.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function describeCorrection(item: PlatformCatalogueCorrection): string {
  const detail = item.barcode ?? item.enteredBrandName;
  return detail ? `correction ${item.id} (${detail})` : `correction ${item.id}`;
}

// The native box stays visible at 20px; the wrapping label gives it a 44px hit area.
const CHECKBOX_HIT_AREA =
  'inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center';
const CHECKBOX = 'size-5 cursor-pointer accent-semantic-primary';
// Reject is destructive: dark red text on the outline button (about 8:1 on white), plus the label.
const REJECT_TEXT = 'text-semantic-critical-muted-foreground';

interface SelectAllCheckboxProps {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
}

function SelectAllCheckbox({ checked, indeterminate, onChange }: SelectAllCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className={CHECKBOX_HIT_AREA}>
      <input
        ref={ref}
        type="checkbox"
        aria-label="Select all corrections"
        className={CHECKBOX}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export default function PlatformCataloguePage({ token }: PlatformCataloguePageProps) {
  const [provenance, setProvenance] = useState<CatalogueProvenanceResponse | null>(null);
  const [corrections, setCorrections] = useState<PlatformCatalogueCorrection[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const correctionsHeadingRef = useRef<HTMLHeadingElement>(null);

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
      setHasMore(queue.nextCursor != null);
      setHasLoaded(true);
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
    setStatusMessage('Saving…');
    const results = await Promise.allSettled(
      ids.map((id) => reviewCatalogueCorrection(id, status, token)),
    );
    const failed = new Set(ids.filter((_id, index) => results[index].status === 'rejected'));
    const succeeded = ids.length - failed.size;
    setSelected(failed);
    if (failed.size > 0) {
      setActionError(
        `${failed.size} correction${failed.size === 1 ? '' : 's'} failed; successful actions were saved.`,
      );
    }
    setStatusMessage(
      succeeded > 0
        ? `${plural(succeeded, 'correction')} ${status === 'ACCEPTED' ? 'accepted' : 'rejected'}.`
        : '',
    );
    await load();
    setBusy(false);
    // The acted-on row is removed, so return focus to a stable point instead of <body>.
    correctionsHeadingRef.current?.focus();
  };

  if (loading && !hasLoaded) {
    return <p role="status">Loading platform catalogue…</p>;
  }
  if (error) {
    return (
      <section aria-labelledby="catalogue-error-heading" className="space-y-3">
        <h1 id="catalogue-error-heading" className="text-3xl font-bold">
          Catalogue provenance and triage
        </h1>
        <p
          role="alert"
          className="rounded-md bg-semantic-critical-muted p-3 text-semantic-critical-muted-foreground"
        >
          {error}
        </p>
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void load()}>
          Retry
        </Button>
      </section>
    );
  }

  const latest = provenance?.latest;
  const allSelected = corrections.length > 0 && corrections.every((item) => selected.has(item.id));
  const someSelected = !allSelected && corrections.some((item) => selected.has(item.id));

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
              <div className="space-y-1">
                <p className="text-lg font-semibold tabular-nums">Version {latest.version}</p>
                <p className="break-all">{latest.sourceFileName}</p>
                <p className="tabular-nums">
                  <time dateTime={latest.seededAt}>
                    {SEEDED_AT_FORMAT.format(new Date(latest.seededAt))}
                  </time>
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {(
                  [
                    ['Inserted', latest.inserted],
                    ['Updated', latest.updated],
                    ['Unchanged', latest.unchanged],
                    ['Reinstated', latest.reinstated],
                    ['Errors', latest.errorCount],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-sm font-medium">{label}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <div
                className={
                  latest.retired > 0
                    ? 'self-start rounded-md border border-semantic-warning bg-semantic-warning-muted p-3 font-medium text-semantic-warning-muted-foreground'
                    : ''
                }
              >
                {latest.retired > 0
                  ? `${latest.retired} ${latest.retired === 1 ? 'entry' : 'entries'} retired in this seed`
                  : 'No entries retired'}
              </div>
            </div>
            <h3 className="mt-5 font-semibold">Prior runs</h3>
            {provenance.history.length === 0 ? (
              <p>No prior runs.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {provenance.history.map((run) => (
                  <li key={run.id} className="break-words tabular-nums">
                    Version {run.version} · {run.sourceFileName} · {run.retired} retired
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section
        aria-labelledby="corrections-heading"
        aria-busy={busy}
        className="rounded-lg border p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="corrections-heading"
            ref={correctionsHeadingRef}
            tabIndex={-1}
            className="text-xl font-semibold"
          >
            Pending corrections
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="min-h-11"
              disabled={busy || selected.size === 0}
              onClick={() => void runActions([...selected], 'ACCEPTED', true)}
            >
              Accept selected
            </Button>
            <Button
              type="button"
              variant="outline"
              className={`min-h-11 ${REJECT_TEXT}`}
              disabled={busy || selected.size === 0}
              onClick={() => void runActions([...selected], 'REJECTED', true)}
            >
              Reject selected
            </Button>
          </div>
        </div>
        <p role="status" aria-live="polite" className="mt-3 empty:hidden">
          {statusMessage}
        </p>
        {actionError && (
          <p
            role="alert"
            className="mt-3 rounded-md bg-semantic-critical-muted p-3 text-semantic-critical-muted-foreground"
          >
            {actionError}
          </p>
        )}
        {hasMore && (
          <p className="mt-3">
            Showing the first {plural(corrections.length, 'correction')}. More are pending and load
            as these are reviewed.
          </p>
        )}
        {corrections.length === 0 ? (
          <p>No pending catalogue corrections.</p>
        ) : (
          <Table className="mt-4">
            <TableCaption className="sr-only">Pending catalogue corrections</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SelectAllCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={(checked) =>
                      setSelected(checked ? new Set(corrections.map((item) => item.id)) : new Set())
                    }
                  />
                </TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Entered brand</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {corrections.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <label className={CHECKBOX_HIT_AREA}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${describeCorrection(item)}`}
                        className={CHECKBOX}
                        checked={selected.has(item.id)}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setSelected(next);
                        }}
                      />
                    </label>
                  </TableCell>
                  <TableCell>{humanizeKind(item.kind)}</TableCell>
                  <TableCell className="tabular-nums">{item.barcode ?? '—'}</TableCell>
                  <TableCell>{item.enteredBrandName ?? '—'}</TableCell>
                  <TableCell>{item.chosenSupplier?.name ?? '—'}</TableCell>
                  <TableCell>{item.organization.name}</TableCell>
                  <TableCell className="tabular-nums">{age(item.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        disabled={busy}
                        aria-label={`Accept ${describeCorrection(item)}`}
                        onClick={() => void runActions([item.id], 'ACCEPTED', false)}
                      >
                        Accept
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className={`min-h-11 ${REJECT_TEXT}`}
                        disabled={busy}
                        aria-label={`Reject ${describeCorrection(item)}`}
                        onClick={() => void runActions([item.id], 'REJECTED', true)}
                      >
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
