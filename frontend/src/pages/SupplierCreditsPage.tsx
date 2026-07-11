import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as Sentry from '@sentry/react';
import { useFreshApiToken } from '../hooks/useFreshApiToken';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import * as svc from '../services/supplierCreditService';
import type {
  ClaimablePoolGroup,
  CreditClaim,
  RecoveryReport,
  Supplier,
} from '../types/supplierCredit';

interface Props {
  token: string | null;
}

const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

type Tab = 'to-claim' | 'open' | 'settled';

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-semantic-surface-3 text-semantic-text-secondary',
  SENDING: 'bg-semantic-primary/10 text-semantic-primary',
  SENT: 'bg-semantic-primary/10 text-semantic-primary',
  ACKNOWLEDGED: 'bg-semantic-primary/10 text-semantic-primary',
  CREDITED: 'bg-semantic-success-muted text-semantic-success',
  PARTIALLY_CREDITED: 'bg-semantic-success-muted text-semantic-success',
  REJECTED: 'bg-semantic-critical-muted text-semantic-critical',
  CANCELLED: 'bg-semantic-surface-3 text-semantic-text-secondary',
};

function formatClaimLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

function isFollowUpDue(claim: CreditClaim): boolean {
  return (
    (claim.status === 'SENT' || claim.status === 'ACKNOWLEDGED') &&
    claim.nextFollowUpAt != null &&
    new Date(claim.nextFollowUpAt).getTime() <= Date.now()
  );
}

const SupplierCreditsPage: React.FC<Props> = ({ token }) => {
  const getFreshApiToken = useFreshApiToken(token);
  const [tab, setTab] = useState<Tab>('to-claim');
  const [pool, setPool] = useState<ClaimablePoolGroup[]>([]);
  const [claims, setClaims] = useState<CreditClaim[]>([]);
  const [report, setReport] = useState<RecoveryReport | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [buildGroup, setBuildGroup] = useState<ClaimablePoolGroup | null>(null);
  const [assignItem, setAssignItem] = useState<{ productId: number; sku: string } | null>(null);
  const [detailClaim, setDetailClaim] = useState<CreditClaim | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const authToken = (await getFreshApiToken('supplier-credits')) || null;
      const [poolData, openClaims, settledClaims, reportData, supplierData] = await Promise.all([
        svc.getClaimablePool(authToken),
        svc.listClaims('open', authToken),
        svc.listClaims('settled', authToken),
        svc.getRecoveryReport(authToken),
        svc.getSuppliers(authToken),
      ]);
      setPool(poolData);
      setClaims([...openClaims, ...settledClaims]);
      setReport(reportData);
      setSuppliers(supplierData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load supplier credits');
      Sentry.captureException(err, { tags: { feature: 'supplier-credits' } });
    } finally {
      setLoading(false);
    }
  }, [getFreshApiToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const openClaims = useMemo(
    () => claims.filter((c) => ['DRAFT', 'SENDING', 'SENT', 'ACKNOWLEDGED'].includes(c.status)),
    [claims],
  );
  const settledClaims = useMemo(
    () => claims.filter((c) => !['DRAFT', 'SENDING', 'SENT', 'ACKNOWLEDGED'].includes(c.status)),
    [claims],
  );
  const followUpDueCount = useMemo(() => openClaims.filter(isFollowUpDue).length, [openClaims]);

  if (loading) {
    return (
      <div
        className="container mx-auto px-4 py-8"
        role="status"
        aria-label="Loading supplier credits"
      >
        <div className="h-8 w-56 rounded bg-semantic-surface-3 animate-pulse" />
        <div className="mt-6 h-40 w-full rounded bg-semantic-surface-3 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <p className="text-semantic-critical font-medium">{error}</p>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold font-heading">Supplier Credits</h1>
        <p className="mt-2 max-w-2xl text-sm text-semantic-text-secondary">
          Turn written-off stock back into supplier credits. Build a claim, attach photos, send it,
          and let the app chase the follow-up.
        </p>
      </header>

      {report && <RecoveryPanel report={report} />}

      <nav className="mt-8 mb-4 flex gap-2 border-b" aria-label="Supplier credit views">
        <TabButton active={tab === 'to-claim'} onClick={() => setTab('to-claim')}>
          To Claim
        </TabButton>
        <TabButton active={tab === 'open'} onClick={() => setTab('open')}>
          Open Claims{followUpDueCount > 0 ? ` (${followUpDueCount} due)` : ''}
        </TabButton>
        <TabButton active={tab === 'settled'} onClick={() => setTab('settled')}>
          Settled
        </TabButton>
      </nav>

      {tab === 'to-claim' && (
        <ToClaimBoard
          pool={pool}
          onBuild={setBuildGroup}
          onAssign={(productId, sku) => setAssignItem({ productId, sku })}
        />
      )}
      {tab === 'open' && (
        <ClaimList claims={openClaims} onOpen={setDetailClaim} emptyLabel="No open claims." />
      )}
      {tab === 'settled' && (
        <ClaimList
          claims={settledClaims}
          onOpen={setDetailClaim}
          emptyLabel="No settled claims yet."
        />
      )}

      {buildGroup && (
        <BuildClaimModal
          group={buildGroup}
          getToken={async () => (await getFreshApiToken('supplier-credits-build')) ?? null}
          onClose={() => setBuildGroup(null)}
          onbuilt={() => {
            setBuildGroup(null);
            void load();
          }}
        />
      )}
      {assignItem && (
        <AssignSupplierModal
          item={assignItem}
          suppliers={suppliers}
          getToken={async () => (await getFreshApiToken('supplier-credits-assign')) ?? null}
          onClose={() => setAssignItem(null)}
          onAssigned={() => {
            setAssignItem(null);
            void load();
          }}
        />
      )}
      {detailClaim && (
        <ClaimDetailModal
          claim={detailClaim}
          getToken={async () => (await getFreshApiToken('supplier-credits-detail')) ?? null}
          onClose={() => setDetailClaim(null)}
          onChanged={() => {
            setDetailClaim(null);
            void load();
          }}
        />
      )}
    </div>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    onClick={onClick}
    className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
      active
        ? 'border-semantic-primary text-semantic-primary'
        : 'border-transparent text-semantic-text-secondary hover:text-semantic-text-primary'
    }`}
    aria-current={active ? 'page' : undefined}
  >
    {children}
  </button>
);

const RecoveryPanel: React.FC<{ report: RecoveryReport }> = ({ report }) => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-semantic-text-secondary">Outstanding credit</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">
          {currency.format(report.outstandingValue)}
        </p>
        <p className="mt-1 text-xs text-semantic-text-tertiary">Owed on sent, unsettled claims</p>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-semantic-text-secondary">Money on the table</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums text-semantic-critical">
          {currency.format(report.unclaimedValue)}
        </p>
        <p className="mt-1 text-xs text-semantic-text-tertiary">
          Eligible write-offs never claimed
        </p>
      </CardContent>
    </Card>
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-semantic-text-secondary">Recovery by supplier</CardTitle>
      </CardHeader>
      <CardContent>
        {report.suppliers.length === 0 ? (
          <p className="text-sm text-semantic-text-tertiary">No claims yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {report.suppliers.slice(0, 4).map((s) => (
              <li key={s.supplierId} className="flex justify-between">
                <span className="truncate">{s.supplierName}</span>
                <span className="tabular-nums text-semantic-text-secondary">
                  {s.recoveryRate == null ? '—' : `${Math.round(s.recoveryRate * 100)}%`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  </div>
);

const ToClaimBoard: React.FC<{
  pool: ClaimablePoolGroup[];
  onBuild: (group: ClaimablePoolGroup) => void;
  onAssign: (productId: number, sku: string) => void;
}> = ({ pool, onBuild, onAssign }) => {
  if (pool.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-sm text-semantic-text-secondary">
        Nothing to claim right now. Expired write-offs will appear here grouped by supplier.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {pool.map((group) => (
        <Card key={group.supplierId ?? 'needs-supplier'}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">
              {group.supplierName ?? '⚠ Needs supplier'}
              <span className="ml-2 text-sm font-normal text-semantic-text-secondary">
                {group.items.length} item{group.items.length === 1 ? '' : 's'}
                {group.supplierId != null &&
                  ` · ~${currency.format(group.expectedCreditValueTotal)} expected`}
              </span>
            </CardTitle>
            {group.supplierId != null && (
              <Button size="sm" onClick={() => onBuild(group)}>
                Build claim
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {group.items.map((item) => (
                <li
                  key={item.transactionId}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{item.productName}</span>{' '}
                    <span className="font-mono text-semantic-text-secondary">{item.sku}</span> ·{' '}
                    {item.unitsDiscarded} units
                  </span>
                  {group.supplierId == null && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAssign(item.productId, item.sku)}
                    >
                      Assign supplier
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

const ClaimList: React.FC<{
  claims: CreditClaim[];
  onOpen: (claim: CreditClaim) => void;
  emptyLabel: string;
}> = ({ claims, onOpen, emptyLabel }) => {
  if (claims.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-sm text-semantic-text-secondary">
        {emptyLabel}
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {claims.map((claim) => (
        <li key={claim.id}>
          <button
            onClick={() => onOpen(claim)}
            className="flex w-full items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-semantic-surface-2/50"
          >
            <span>
              <span className="font-medium">Claim #{claim.id}</span> · {claim.supplier.name}
              <span className="ml-2 text-sm text-semantic-text-secondary">
                {claim.lines.length} line{claim.lines.length === 1 ? '' : 's'} ·{' '}
                {claim.expectedCreditValue != null
                  ? `~${currency.format(claim.expectedCreditValue)}`
                  : 'TBC'}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {isFollowUpDue(claim) && (
                <Badge className="bg-semantic-critical-muted text-semantic-critical">
                  Follow-up due
                </Badge>
              )}
              <Badge className={STATUS_TONE[claim.status] ?? ''}>
                {formatClaimLabel(claim.status)}
              </Badge>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
};

// ── Modals ─────────────────────────────────────────────────────────────────────

const BuildClaimModal: React.FC<{
  group: ClaimablePoolGroup;
  getToken: () => Promise<string | null>;
  onClose: () => void;
  onbuilt: () => void;
}> = ({ group, getToken, onClose, onbuilt }) => {
  const [batches, setBatches] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const token = await getToken();
      await svc.buildClaim(
        group.supplierId as number,
        group.items.map((item) => ({
          expiredItemTransactionId: item.transactionId,
          batchNumber: batches[item.transactionId]?.trim() || null,
        })),
        token,
      );
      onbuilt();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to build claim');
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New claim · {group.supplierName}</DialogTitle>
        </DialogHeader>
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {group.items.map((item) => (
            <div key={item.transactionId} className="rounded-md border p-3">
              <p className="text-sm font-medium">
                {item.productName}{' '}
                <span className="font-mono text-semantic-text-secondary">{item.sku}</span>
              </p>
              <p className="text-xs text-semantic-text-secondary">
                {item.unitsDiscarded} units · expect{' '}
                {item.expectedCreditUnits == null ? '—' : `${item.expectedCreditUnits} unit(s)`}
              </p>
              <div className="mt-2">
                <Label htmlFor={`batch-${item.transactionId}`} className="text-xs">
                  Batch number
                </Label>
                <Input
                  id={`batch-${item.transactionId}`}
                  value={batches[item.transactionId] ?? ''}
                  onChange={(e) =>
                    setBatches((b) => ({ ...b, [item.transactionId]: e.target.value }))
                  }
                />
              </div>
            </div>
          ))}
        </div>
        {err && <p className="text-sm text-semantic-critical">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create draft claim'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const AssignSupplierModal: React.FC<{
  item: { productId: number; sku: string };
  suppliers: Supplier[];
  getToken: () => Promise<string | null>;
  onClose: () => void;
  onAssigned: () => void;
}> = ({ item, suppliers, getToken, onClose, onAssigned }) => {
  const [mode, setMode] = useState<'existing' | 'new'>(suppliers.length > 0 ? 'existing' : 'new');
  const [supplierId, setSupplierId] = useState<number | ''>(suppliers[0]?.id ?? '');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [writeOffQty, setWriteOffQty] = useState('');
  const [creditQty, setCreditQty] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const token = await getToken();
      let targetId: number;
      if (mode === 'new') {
        const created = await svc.createSupplier(
          {
            name,
            contactEmail: email || null,
            policyWriteOffQty: writeOffQty ? Number(writeOffQty) : null,
            policyCreditQty: creditQty ? Number(creditQty) : null,
          },
          token,
        );
        targetId = created.id;
      } else {
        targetId = supplierId as number;
      }
      await svc.assignProductSupplier(item.productId, targetId, token);
      onAssigned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to assign supplier');
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign supplier · {item.sku}</DialogTitle>
        </DialogHeader>
        {suppliers.length > 0 && (
          <div className="mb-3 flex gap-2">
            <Button
              variant={mode === 'existing' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('existing')}
            >
              Existing
            </Button>
            <Button
              variant={mode === 'new' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('new')}
            >
              New supplier
            </Button>
          </div>
        )}
        {mode === 'existing' ? (
          <div>
            <Label htmlFor="supplier-select">Supplier</Label>
            <select
              id="supplier-select"
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={supplierId}
              onChange={(e) => setSupplierId(Number(e.target.value))}
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="new-name">Name</Label>
              <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="new-email">Contact email</Label>
              <Input
                id="new-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="wo-qty">Write off</Label>
                <Input
                  id="wo-qty"
                  type="number"
                  min="1"
                  value={writeOffQty}
                  onChange={(e) => setWriteOffQty(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cr-qty">Credit</Label>
                <Input
                  id="cr-qty"
                  type="number"
                  min="0"
                  value={creditQty}
                  onChange={(e) => setCreditQty(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-semantic-text-tertiary">
              e.g. 3 &amp; 1 for a 3-for-1 policy. Leave blank if there is no fixed ratio.
            </p>
          </div>
        )}
        {err && <p className="mt-2 text-sm text-semantic-critical">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={
              submitting || (mode === 'new' && !name) || (mode === 'existing' && supplierId === '')
            }
          >
            {submitting ? 'Saving…' : 'Assign'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ClaimDetailModal: React.FC<{
  claim: CreditClaim;
  getToken: () => Promise<string | null>;
  onClose: () => void;
  onChanged: () => void;
}> = ({ claim, getToken, onClose, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [creditedValue, setCreditedValue] = useState('');
  const [uploadingLine, setUploadingLine] = useState<number | null>(null);

  const uploadPhoto = async (lineId: number, file: File) => {
    setUploadingLine(lineId);
    setErr(null);
    try {
      await svc.uploadClaimPhoto(claim.id, lineId, file, await getToken());
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Photo upload failed');
      setUploadingLine(null);
    }
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Claim #{claim.id} · {claim.supplier.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1 text-sm">
          <p>
            Status: <span className="font-medium">{formatClaimLabel(claim.status)}</span>
          </p>
          <p className="text-semantic-text-secondary">
            Expected{' '}
            {claim.expectedCreditValue != null ? currency.format(claim.expectedCreditValue) : 'TBC'}
            {claim.creditedValue != null && ` · credited ${currency.format(claim.creditedValue)}`}
          </p>
        </div>

        {claim.status === 'DRAFT' && claim.lines.length > 0 && (
          <div className="my-3 rounded-md border p-2">
            <p className="mb-1 text-xs font-semibold uppercase text-semantic-text-secondary">
              Photos (attach before sending)
            </p>
            <ul className="space-y-2">
              {claim.lines.map((line) => (
                <li key={line.id} className="flex items-center justify-between text-xs">
                  <span>
                    Batch {line.batchNumber ?? '—'} · {line.unitsClaimed} units ·{' '}
                    {line.photos.length} photo(s)
                  </span>
                  <label className="cursor-pointer text-semantic-primary">
                    {uploadingLine === line.id ? 'Uploading…' : 'Add photo'}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingLine != null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadPhoto(line.id, file);
                      }}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="my-3 max-h-40 overflow-y-auto rounded-md border p-2">
          <p className="mb-1 text-xs font-semibold uppercase text-semantic-text-secondary">
            Timeline
          </p>
          <ul className="space-y-1 text-xs">
            {claim.events.map((ev) => (
              <li key={ev.id} className="flex justify-between">
                <span>
                  {formatClaimLabel(ev.type)}
                  {ev.note ? ` — ${ev.note}` : ''}
                </span>
                <span className="text-semantic-text-tertiary">
                  {new Date(ev.createdAt).toLocaleDateString('en-AU')}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {err && <p className="text-sm text-semantic-critical">{err}</p>}

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          {claim.status === 'DRAFT' && (
            <Button
              disabled={busy}
              onClick={() => void run(async () => svc.sendClaim(claim.id, await getToken()))}
            >
              {busy ? 'Sending…' : 'Send claim'}
            </Button>
          )}
          {(claim.status === 'SENT' || claim.status === 'ACKNOWLEDGED') && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run(async () => svc.sendFollowUp(claim.id, await getToken()))}
              >
                Send follow-up
              </Button>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor="credited" className="text-xs">
                    Credited value
                  </Label>
                  <Input
                    id="credited"
                    type="number"
                    min="0"
                    value={creditedValue}
                    onChange={(e) => setCreditedValue(e.target.value)}
                  />
                </div>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      svc.recordOutcome(
                        claim.id,
                        'CREDITED',
                        creditedValue ? Number(creditedValue) : null,
                        null,
                        await getToken(),
                      ),
                    )
                  }
                >
                  Mark credited
                </Button>
                <Button
                  variant="outline"
                  className="text-semantic-critical border-semantic-critical"
                  disabled={busy}
                  onClick={() =>
                    void run(async () =>
                      svc.recordOutcome(claim.id, 'REJECTED', null, null, await getToken()),
                    )
                  }
                >
                  Rejected
                </Button>
              </div>
            </>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SupplierCreditsPage;
