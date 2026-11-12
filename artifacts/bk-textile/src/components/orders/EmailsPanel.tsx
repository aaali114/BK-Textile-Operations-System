import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Download, Paperclip, X } from 'lucide-react';
import {
  downloadOrderEmailAttachment, getGetOrderEmailQueryKey, getGetOrderEmailsQueryKey, useGetOrderEmail, useGetOrderEmails, useUpdateOrderEmail,
} from '@workspace/api-client-react';
import type { EmailAttachment, EmailCategory, OrderEmailUpdate } from '@workspace/api-client-react';
import { EmptyState, Notice, QueryError, SkeletonRows } from './ui';
import { apiErrorInfo, dateTimeText, humanize, refreshAfterEmailReview } from './helpers';

const CATEGORIES: EmailCategory[] = ['order_details', 'tech_pack', 'trims_accessories', 'sample_requirements', 'packaging', 'amendment', 'other', 'unclassified'];
const matchClass = (s: string) => (s === 'needs_review' ? 'warn' : s === 'ignored' ? 'neutral' : 'blue');
const sizeText = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);

function AttachmentButton({ orderId, emailId, att }: { orderId: string; emailId: string; att: EmailAttachment }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const download = async () => {
    setBusy(true); setErr(null);
    try {
      const blob = await downloadOrderEmailAttachment(orderId, emailId, att.id, { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = att.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setErr(apiErrorInfo(e).message); } finally { setBusy(false); }
  };
  return <span className="att-item"><button type="button" className="att-btn" onClick={download} disabled={busy} aria-label={`Download ${att.filename}`} data-testid={`button-attachment-${att.id}`}><Download size={12} />{busy ? 'Downloading…' : att.filename}<span className="muted-copy"> · {sizeText(att.sizeBytes)}</span></button>{err && <span className="inline-error" role="alert">{err}</span>}</span>;
}

function EmailDetail({ orderId, emailId, onClose }: { orderId: string; emailId: string; onClose: () => void }) {
  const client = useQueryClient();
  const q = useGetOrderEmail(orderId, emailId, { query: { queryKey: getGetOrderEmailQueryKey(orderId, emailId), enabled: !!emailId } });
  const update = useUpdateOrderEmail();
  const [msg, setMsg] = useState<{ message: string; error?: boolean } | null>(null);
  const review = (data: OrderEmailUpdate, done: string) => {
    setMsg(null);
    update.mutate({ orderId, emailId, data }, {
      onSuccess: () => { refreshAfterEmailReview(client, orderId, emailId); setMsg({ message: done }); },
      onError: (e) => setMsg({ message: apiErrorInfo(e).message, error: true }),
    });
  };
  const e = q.data;
  return <article className="email-detail" aria-label="Email detail" data-testid="panel-email-detail">
    <div className="email-detail-head"><p className="panel-kicker">Source email</p><button type="button" className="icon-btn" onClick={onClose} aria-label="Close email"><X size={15} /></button></div>
    {q.isError ? <QueryError title="Email could not be loaded" onRetry={() => q.refetch()} /> : q.isLoading ? <SkeletonRows count={3} /> : e && <>
      <h3 className="email-subject">{e.subject || '(no subject)'}</h3>
      <dl className="email-meta">
        <dt>From</dt><dd>{e.fromName ? `${e.fromName} <${e.fromAddress}>` : e.fromAddress}</dd>
        {e.toAddresses.length > 0 && <><dt>To</dt><dd>{e.toAddresses.join(', ')}</dd></>}
        {e.ccAddresses.length > 0 && <><dt>Cc</dt><dd>{e.ccAddresses.join(', ')}</dd></>}
        <dt>Received</dt><dd>{dateTimeText(e.receivedAt)}{e.sentAt && <span className="muted-copy"> · sent {dateTimeText(e.sentAt)}</span>}</dd>
        <dt>Match</dt><dd><span className={`status-pill ${matchClass(e.matchStatus)}`}>{humanize(e.matchStatus)}</span> <span className="muted-copy">via {humanize(e.matchMethod)}{e.matchReason ? ` — ${e.matchReason}` : ''}</span></dd>
        <dt>Parse</dt><dd>{humanize(e.parseStatus)}{e.parseError && <span className="inline-error"> {e.parseError}</span>}</dd>
      </dl>
      {msg && <Notice message={msg.message} error={msg.error} onClose={() => setMsg(null)} />}
      {e.matchStatus === 'needs_review' && <div className="review-bar" data-testid="bar-email-review">
        <span className="review-label">Needs review</span>
        <label className="sr-only" htmlFor="email-category">Category</label>
        <select id="email-category" className="select" style={{ width: 190 }} value={e.category} disabled={update.isPending} onChange={(ev) => review({ category: ev.target.value as EmailCategory }, 'Category updated.')} data-testid="select-email-category">{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>
        <button type="button" className="btn btn-primary" disabled={update.isPending} onClick={() => review({ matchStatus: 'matched' }, 'Email confirmed for this order.')} data-testid="button-email-confirm"><Check size={14} />{update.isPending ? 'Saving…' : 'Confirm'}</button>
        <button type="button" className="btn btn-quiet" disabled={update.isPending} onClick={() => review({ matchStatus: 'ignored' }, 'Email ignored for this order.')} data-testid="button-email-ignore"><X size={14} />Ignore</button>
      </div>}
      {e.matchStatus !== 'needs_review' && <p className="support-note">Category: {humanize(e.category)}</p>}
      {e.attachments.length > 0 && <div className="att-list"><Paperclip size={13} />{e.attachments.map((a) => <AttachmentButton key={a.id} orderId={orderId} emailId={e.id} att={a} />)}</div>}
      <pre className="email-body" data-testid="text-email-body">{e.bodyText ?? 'No plain-text body was captured for this email.'}</pre>
    </>}
  </article>;
}

export function EmailsPanel({ orderId, selectedId, onSelect }: { orderId: string; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const q = useGetOrderEmails(orderId, { query: { queryKey: getGetOrderEmailsQueryKey(orderId), enabled: !!orderId } });
  const emails = useMemo(() => [...(q.data ?? [])].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)), [q.data]);
  return <section className="panel" aria-label="Linked emails" data-testid="section-emails">
    <div className="panel-head"><div><p className="panel-kicker">Source correspondence · newest first</p><h2 className="panel-title">Emails {q.data && <span className="mono count">· {q.data.length}</span>}</h2></div></div>
    {q.isError ? <QueryError title="Emails could not be loaded" onRetry={() => q.refetch()} /> : q.isLoading ? <SkeletonRows count={3} /> : !emails.length ? <EmptyState title="No linked emails" text="Emails matched to this PO or BK invoice will appear here." /> :
      <div className={`email-layout${selectedId ? ' has-detail' : ''}`}>
        <ul className="email-list" role="list">{emails.map((e) => <li key={e.id}>
          <button type="button" className={`email-row${selectedId === e.id ? ' selected' : ''}`} aria-current={selectedId === e.id} onClick={() => onSelect(e.id)} data-testid={`row-email-${e.id}`}>
            <span className="email-row-top"><strong>{e.subject || '(no subject)'}</strong><time dateTime={e.receivedAt}>{dateTimeText(e.receivedAt)}</time></span>
            <span className="email-row-from">{e.fromName || e.fromAddress}</span>
            <span className="email-row-tags"><span className="type-tag">{humanize(e.category)}</span><span className={`status-pill ${matchClass(e.matchStatus)}`}>{humanize(e.matchStatus)}</span>{e.attachments.length > 0 && <span className="muted-copy"><Paperclip size={11} /> {e.attachments.length}</span>}</span>
          </button>
          {e.attachments.length > 0 && selectedId !== e.id && <div className="att-list compact">{e.attachments.map((a) => <AttachmentButton key={a.id} orderId={orderId} emailId={e.id} att={a} />)}</div>}
        </li>)}</ul>
        {selectedId && <EmailDetail key={selectedId} orderId={orderId} emailId={selectedId} onClose={() => onSelect(null)} />}
      </div>}
  </section>;
}
