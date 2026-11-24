import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { AlertTriangle, ArchiveRestore, FileImage, FileText, Mail, Shirt, Trash2 } from 'lucide-react';
import {
  getListBinQueryKey, useListBin, usePurgeBinItem, useRestoreOrder, useRestoreOrderDocument, useRestoreOrderEmail, useRestoreOrderFile,
} from '@workspace/api-client-react';
import type { BinItem } from '@workspace/api-client-react';
import { EmptyState, Notice, PageFrame, PageHeading, QueryError, SkeletonRows } from '../orders/ui';
import { apiErrorInfo, dateTimeText } from '../orders/helpers';
import { useAccess } from '../access/AccessProvider';
import { DocDialog } from '../documents/ui';
import { BIN_KIND_LABELS, purgeConfirmMatches, purgeConfirmTarget, sortBinNewestFirst } from './bin-helpers';
import { refreshAfterBinChange } from './bin-cache';
import './bin.css';

const KIND_ICONS = { order: Shirt, file: FileImage, email: Mail, document: FileText } as const;
const itemKey = (i: BinItem) => `${i.kind}-${i.id}`;

function PurgeDialog({ item, busy, error, onConfirm, onClose }: { item: BinItem; busy: boolean; error: string | null; onConfirm: () => void; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const target = purgeConfirmTarget(item);
  const ok = purgeConfirmMatches(item, typed);
  return <DocDialog testId="dialog-purge" eyebrow="Permanent deletion" title="Delete permanently?" onClose={() => { if (!busy) onClose(); }}>
    <div className="doc-warning" role="alert" style={{ marginBottom: 12 }}><AlertTriangle size={15} /><span>
      <strong>{BIN_KIND_LABELS[item.kind]}: {item.title}</strong> will be removed for good.
      {item.kind === 'order' ? <> Its invoice number {item.orderRef} is retired and will not be reused. This cannot be undone.</> : ' This cannot be undone.'}
    </span></div>
    <div className="form-field"><label htmlFor="purge-confirm">Type <span className="purge-target">{target}</span> to confirm</label>
      <input id="purge-confirm" className="field mono" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="input-purge-confirm" /></div>
    {error && <div className="feedback error" role="alert" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}
    <div className="modal-actions"><button type="button" className="btn btn-quiet" disabled={busy} onClick={onClose} data-testid="button-purge-cancel">Cancel</button>
      <button type="button" className="btn btn-danger" disabled={!ok || busy} onClick={onConfirm} data-testid="button-purge-confirm"><Trash2 size={14} />{busy ? 'Deleting…' : 'Delete permanently'}</button></div>
  </DocDialog>;
}

export function BinPage() {
  const access = useAccess();
  const writable = access.canWrite('merchandising');
  const client = useQueryClient();
  const query = useListBin({ query: { queryKey: getListBinQueryKey(), enabled: writable } });
  const items = useMemo(() => sortBinNewestFirst(query.data ?? []), [query.data]);
  const restoreOrder = useRestoreOrder();
  const restoreFile = useRestoreOrderFile();
  const restoreDocument = useRestoreOrderDocument();
  const restoreEmail = useRestoreOrderEmail();
  const purge = usePurgeBinItem();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<BinItem | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const done = (item: BinItem, message: string) => {
    client.setQueryData<BinItem[]>(getListBinQueryKey(), (old) => old?.filter((x) => itemKey(x) !== itemKey(item)));
    refreshAfterBinChange(client, item.orderId);
    setNotice({ message });
  };
  const restore = (item: BinItem) => {
    const key = itemKey(item);
    setBusyKey(key); setNotice(null);
    setRowErrors((e) => { const next = { ...e }; delete next[key]; return next; });
    const handlers = {
      onSuccess: () => done(item, `${BIN_KIND_LABELS[item.kind]} "${item.title}" restored to ${item.orderRef}.`),
      onError: (err: unknown) => setRowErrors((e) => ({ ...e, [key]: apiErrorInfo(err).message })),
      onSettled: () => setBusyKey(null),
    };
    const orderId = item.orderId;
    if (item.kind === 'order') restoreOrder.mutate({ orderId }, handlers);
    else if (item.kind === 'file') restoreFile.mutate({ orderId, fileId: item.id }, handlers);
    else if (item.kind === 'document') restoreDocument.mutate({ orderId, documentId: item.id }, handlers);
    else restoreEmail.mutate({ orderId, emailId: item.id }, handlers);
  };
  const doPurge = () => {
    if (!purgeTarget) return;
    const item = purgeTarget;
    setPurgeError(null);
    purge.mutate({ kind: item.kind, orderId: item.orderId, itemId: item.id }, {
      onSuccess: () => { setPurgeTarget(null); done(item, `${BIN_KIND_LABELS[item.kind]} "${item.title}" deleted permanently.`); },
      onError: (err) => setPurgeError(apiErrorInfo(err).message),
    });
  };

  return <PageFrame>
    <PageHeading eyebrow="Production office · Deleted items" title="Bin" subtitle="Orders, pictures, files, emails and documents that were deleted. Restore anything here; items inside a deleted order come back with the order." />
    {notice && <Notice message={notice.message} error={notice.error} onClose={() => setNotice(null)} />}
    <section className="panel">
      <div className="panel-head"><div><p className="panel-kicker">Newest first</p><h2 className="panel-title">Deleted items {query.data && <span className="mono" style={{ fontSize: 11, color: '#82908a', fontWeight: 400 }}>· {query.data.length}</span>}</h2></div><Trash2 size={16} color="#66807e" /></div>
      {!writable ? <EmptyState title="The Bin needs order register write access" text="Ask an administrator for write access to the order register to see and restore deleted items." />
        : query.isError ? <QueryError title="Could not load the Bin" detail={apiErrorInfo(query.error).message} onRetry={() => query.refetch()} />
        : query.isLoading ? <SkeletonRows />
        : !items.length ? <EmptyState title="The Bin is empty" text="Deleted orders, pictures, files, emails and documents will wait here until they are restored." />
        : <div className="table-scroll"><table className="data-table" data-testid="table-bin"><thead><tr><th>Type</th><th>Item</th><th>Order</th><th>Deleted</th><th>Reason</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
          <tbody>{items.map((item) => {
            const Icon = KIND_ICONS[item.kind];
            const key = itemKey(item);
            return [<tr key={key} data-testid={`row-bin-${key}`}>
              <td><span className="bin-kind"><span className="document-icon"><Icon size={14} /></span>{BIN_KIND_LABELS[item.kind]}</span></td>
              <td><div className="bin-title">{item.title}</div>{item.detail && <div className="bin-detail">{item.detail}</div>}</td>
              <td><Link href={`/orders/${item.orderId}`} className="ref-link" data-testid={`link-bin-order-${key}`}>{item.orderRef}</Link><div className="bin-detail mono">PO {item.poNumber || '—'}</div></td>
              <td><div>{item.archivedBy || 'Unknown'}</div><div className="bin-detail mono">{dateTimeText(item.archivedAt)}</div></td>
              <td>{item.reason ? <div className="bin-reason">{item.reason}</div> : <span className="muted-copy">—</span>}</td>
              <td><div className="bin-actions">
                {item.canRestore && <button type="button" className="btn btn-quiet" disabled={busyKey === key} onClick={() => restore(item)} data-testid={`button-restore-${key}`}><ArchiveRestore size={13} />{busyKey === key ? 'Restoring…' : 'Restore'}</button>}
                {item.canPurge && <button type="button" className="btn btn-danger-quiet" disabled={busyKey === key} onClick={() => { setPurgeError(null); setPurgeTarget(item); }} data-testid={`button-purge-${key}`}><Trash2 size={13} />Delete permanently</button>}
              </div></td>
            </tr>, rowErrors[key] ? <tr key={`${key}-error`} className="bin-row-error"><td colSpan={6}><div className="feedback error" role="alert" style={{ margin: 0 }}>{rowErrors[key]}</div></td></tr> : null];
          })}</tbody></table></div>}
    </section>
    {purgeTarget && <PurgeDialog key={itemKey(purgeTarget)} item={purgeTarget} busy={purge.isPending} error={purgeError} onConfirm={doPurge} onClose={() => setPurgeTarget(null)} />}
  </PageFrame>;
}
