import { type FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Hash, ShieldCheck } from 'lucide-react';
import {
  getGetCurrentUserQueryKey, getGetInvoiceCounterQueryKey, getGetOrderQueryKey, useGetCurrentUser, useGetInvoiceCounter,
  useSetInvoiceCounter, useSetOrderInvoiceNumber,
} from '@workspace/api-client-react';
import type { Order } from '@workspace/api-client-react';
import { apiErrorInfo, invoiceDisplay, refreshOrderCore, validInvoiceInput } from './helpers';
import { Notice, QueryError, SkeletonRows } from './ui';
import { getGetDashboardSummaryQueryKey, getGetOrdersQueryKey } from '@workspace/api-client-react';

/** True only when the role has loaded and isAdmin is exactly true. */
export function useIsAdmin() {
  const me = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), staleTime: 60_000 } });
  return me.data?.isAdmin === true;
}

function ReasonFields({ idPrefix, num, setNum, reason, setReason, numLabel }: { idPrefix: string; num: string; setNum: (v: string) => void; reason: string; setReason: (v: string) => void; numLabel: string }) {
  return <div className="form-grid">
    <div className="form-field"><label htmlFor={`${idPrefix}-num`}>{numLabel} *</label><input id={`${idPrefix}-num`} className="field mono" type="number" min="1" step="1" required value={num} onChange={(e) => setNum(e.target.value)} data-testid={`input-${idPrefix}-number`} /></div>
    <div className="form-field full"><label htmlFor={`${idPrefix}-reason`}>Reason * <span className="optional-label">3–500 characters, recorded in activity</span></label><textarea id={`${idPrefix}-reason`} className="textarea" rows={2} required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`input-${idPrefix}-reason`} /></div>
  </div>;
}

function CounterPanel() {
  const client = useQueryClient();
  const counter = useGetInvoiceCounter({ query: { queryKey: getGetInvoiceCounterQueryKey() } });
  const setCounter = useSetInvoiceCounter();
  const [open, setOpen] = useState(false);
  const [num, setNum] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ message: string; error?: boolean } | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const invalid = validInvoiceInput(num, reason);
    if (invalid) { setMsg({ message: invalid, error: true }); return; }
    setMsg(null);
    setCounter.mutate({ data: { lastNumber: Number(num), reason: reason.trim() } }, {
      onSuccess: (saved) => {
        client.setQueryData(getGetInvoiceCounterQueryKey(), saved);
        void client.invalidateQueries({ queryKey: getGetInvoiceCounterQueryKey() });
        void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() });
        void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        setMsg({ message: `Counter set. Next BK invoice will be ${saved.nextNumber}.` }); setOpen(false); setNum(''); setReason('');
      },
      onError: (err) => setMsg({ message: apiErrorInfo(err).message, error: true }),
    });
  };
  const c = counter.data;
  return <section className="panel admin-panel" aria-label="Invoice numbering" data-testid="panel-invoice-numbering">
    <div className="panel-head"><div><p className="panel-kicker"><ShieldCheck size={11} /> Admin</p><h2 className="panel-title">Invoice numbering</h2></div>
      {!open && c && <button type="button" className="btn btn-quiet" onClick={() => { setOpen(true); setNum(String(c.lastNumber)); setMsg(null); }} data-testid="button-set-counter">Set counter</button>}</div>
    {counter.isError ? <QueryError title="Counter unavailable" onRetry={() => counter.refetch()} /> : counter.isLoading ? <SkeletonRows count={1} /> : c && <div className="counter-strip">
      <div><span className="detail-label">Last issued</span><strong className="mono" data-testid="text-counter-last">{c.lastNumber}</strong></div>
      <div><span className="detail-label">Next number</span><strong className="mono" data-testid="text-counter-next">{c.nextNumber}</strong></div>
      <div><span className="detail-label">Highest on any order</span><strong className="mono">{c.highestUsed ?? '—'}</strong></div>
    </div>}
    <div style={{ padding: msg || open ? '0 20px 18px' : 0 }}>
      {msg && <Notice message={msg.message} error={msg.error} onClose={() => setMsg(null)} />}
      {open && <form onSubmit={submit}><ReasonFields idPrefix="counter" numLabel="Last issued number" num={num} setNum={setNum} reason={reason} setReason={setReason} />
        <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={setCounter.isPending} data-testid="button-save-counter">{setCounter.isPending ? 'Saving…' : 'Save counter'}</button></div></form>}
    </div>
  </section>;
}

export function InvoiceNumberingPanel() { return useIsAdmin() ? <CounterPanel /> : null; }

function Override({ order }: { order: Order }) {
  const client = useQueryClient();
  const mutate = useSetOrderInvoiceNumber();
  const [open, setOpen] = useState(false);
  const [num, setNum] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ message: string; error?: boolean } | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const invalid = validInvoiceInput(num, reason);
    if (invalid) { setMsg({ message: invalid, error: true }); return; }
    setMsg(null);
    mutate.mutate({ orderId: order.id, data: { invoiceNumber: Number(num), reason: reason.trim() } }, {
      onSuccess: (saved) => {
        client.setQueryData(getGetOrderQueryKey(order.id), saved);
        refreshOrderCore(client, order.id);
        void client.invalidateQueries({ queryKey: getGetInvoiceCounterQueryKey() });
        setMsg({ message: `BK invoice is now ${invoiceDisplay(saved).value}.` }); setOpen(false); setReason('');
      },
      onError: (err) => setMsg({ message: apiErrorInfo(err).message, error: true }),
    });
  };
  return <section className="panel admin-panel" style={{ marginBottom: 18 }} aria-label="Override invoice number">
    <div className="panel-head"><div><p className="panel-kicker"><ShieldCheck size={11} /> Admin</p><h2 className="panel-title">BK invoice number</h2></div>
      {!open && <button type="button" className="btn btn-quiet" onClick={() => { setOpen(true); setNum(order.invoiceNumber != null ? String(order.invoiceNumber) : ''); setMsg(null); }} data-testid="button-override-invoice"><Hash size={14} />Override invoice number</button>}</div>
    <div style={{ padding: '14px 20px 18px' }}>
      {msg && <Notice message={msg.message} error={msg.error} onClose={() => setMsg(null)} />}
      {open ? <form onSubmit={submit}><ReasonFields idPrefix="invoice" numLabel="Invoice number" num={num} setNum={setNum} reason={reason} setReason={setReason} />
        <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={mutate.isPending} data-testid="button-save-invoice">{mutate.isPending ? 'Saving…' : 'Override invoice'}</button></div></form>
        : <p className="support-note" style={{ margin: 0 }}>Current: <span className="mono">{invoiceDisplay(order).value}</span>. Changes require a reason and are logged.</p>}
    </div>
  </section>;
}

export function OverrideInvoiceAction({ order }: { order: Order }) { return useIsAdmin() ? <Override order={order} /> : null; }
