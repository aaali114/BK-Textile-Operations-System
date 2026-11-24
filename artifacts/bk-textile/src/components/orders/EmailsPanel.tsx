import { type ChangeEvent, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Download, MailPlus, Paperclip, Trash2, X } from 'lucide-react';
import {
  downloadOrderEmailAttachment, getGetOrderEmailQueryKey, getGetOrderEmailsQueryKey, useArchiveOrderEmail, useGetOrderEmail, useGetOrderEmails,
  useRestoreOrderEmail, useUpdateOrderEmail, useUploadOrderEmail,
} from '@workspace/api-client-react';
import type { EmailAttachment, EmailCategory, OrderEmail, OrderEmailUpdate } from '@workspace/api-client-react';
import { MoveToBinDialog } from '../bin/MoveToBinDialog';
import { EML_HELP_TEXT, EMAIL_REMOVE_TEXT, archiveBody, clearedSummary, dataUrlToBase64, emlFileProblem } from '../bin/bin-helpers';
import { refreshAfterBinChange } from '../bin/bin-cache';
import { EmptyState, Notice, QueryError, SkeletonRows } from './ui';
import { apiErrorInfo, dateTimeText, humanize, refreshAfterEmailReview } from './helpers';
import { useAccess } from '../access/AccessProvider';

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

type RemoveTarget = { id: string; subject: string; notThisOrder: boolean };
type PanelResult = { message: string; warnings?: string[]; error?: boolean };

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(dataUrlToBase64(String(reader.result ?? '')));
    reader.onerror = () => reject(new Error('The file could not be read. Try saving the email again.'));
    reader.readAsDataURL(file);
  });
}

function EmailDetail({ orderId, emailId, onClose, onRemove }: { orderId: string; emailId: string; onClose: () => void; onRemove: (t: RemoveTarget) => void }) {
  const writable = useAccess().canWrite('merchandising');
  const client = useQueryClient();
  const q = useGetOrderEmail(orderId, emailId, { query: { queryKey: getGetOrderEmailQueryKey(orderId, emailId), enabled: !!emailId } });
  const update = useUpdateOrderEmail();
  const confirmEmail = useRestoreOrderEmail();
  const [msg, setMsg] = useState<{ message: string; error?: boolean } | null>(null);
  const review = (data: OrderEmailUpdate, done: string) => {
    if (!writable) return;
    setMsg(null);
    update.mutate({ orderId, emailId, data }, {
      onSuccess: () => { refreshAfterEmailReview(client, orderId, emailId); setMsg({ message: done }); },
      onError: (e) => setMsg({ message: apiErrorInfo(e).message, error: true }),
    });
  };
  const confirm = () => {
    if (!writable) return;
    setMsg(null);
    confirmEmail.mutate({ orderId, emailId }, {
      onSuccess: (report) => { refreshAfterBinChange(client, orderId); setMsg({ message: `Email confirmed for this order and its data applied. ${clearedSummary(report?.cleared)}` }); },
      onError: (err) => setMsg({ message: apiErrorInfo(err).message, error: true }),
    });
  };
  const busy = update.isPending || confirmEmail.isPending;
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
      {e.matchStatus === 'needs_review' && writable && <div className="review-bar" data-testid="bar-email-review">
        <span className="review-label">Needs review</span>
        <label className="sr-only" htmlFor="email-category">Category</label>
        <select id="email-category" className="select" style={{ width: 190 }} value={e.category} disabled={busy} onChange={(ev) => review({ category: ev.target.value as EmailCategory }, 'Category updated.')} data-testid="select-email-category">{CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={confirm} data-testid="button-email-confirm"><Check size={14} />{confirmEmail.isPending ? 'Confirming…' : 'Confirm'}</button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => onRemove({ id: e.id, subject: e.subject || '(no subject)', notThisOrder: true })} data-testid="button-email-not-this-order"><X size={14} />Not this order</button>
      </div>}
      {(e.matchStatus !== 'needs_review' || !writable) && <p className="support-note">Category: {humanize(e.category)}</p>}
      {writable && e.matchStatus !== 'needs_review' && <div style={{ marginTop: 10 }}><button type="button" className="btn btn-danger-quiet" onClick={() => onRemove({ id: e.id, subject: e.subject || '(no subject)', notThisOrder: false })} data-testid="button-email-remove-detail"><Trash2 size={13} />Remove from order</button></div>}
      {e.attachments.length > 0 && <div className="att-list"><Paperclip size={13} />{e.attachments.map((a) => <AttachmentButton key={a.id} orderId={orderId} emailId={e.id} att={a} />)}</div>}
      <pre className="email-body" data-testid="text-email-body">{e.bodyText ?? 'No plain-text body was captured for this email.'}</pre>
    </>}
  </article>;
}

export function EmailsPanel({ orderId, selectedId, onSelect }: { orderId: string; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const writable = useAccess().canWrite('merchandising');
  const client = useQueryClient();
  const q = useGetOrderEmails(orderId, { query: { queryKey: getGetOrderEmailsQueryKey(orderId), enabled: !!orderId } });
  const emails = useMemo(() => [...(q.data ?? [])].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)), [q.data]);
  const archiveEmail = useArchiveOrderEmail();
  const upload = useUploadOrderEmail();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<PanelResult | null>(null);
  const [target, setTarget] = useState<RemoveTarget | null>(null);
  const [binError, setBinError] = useState<string | null>(null);
  const openRemove = (t: RemoveTarget) => { setBinError(null); setTarget(t); };
  const remove = (reason: string) => {
    if (!target) return;
    const t = target;
    setBinError(null);
    archiveEmail.mutate({ orderId, emailId: t.id, data: archiveBody(reason) }, {
      onSuccess: (report) => {
        client.setQueryData<OrderEmail[]>(getGetOrderEmailsQueryKey(orderId), (old) => old?.filter((x) => x.id !== t.id));
        refreshAfterBinChange(client, orderId);
        if (selectedId === t.id) onSelect(null);
        setTarget(null);
        setResult({ message: `${t.notThisOrder ? 'Marked as not this order and moved to the Bin.' : 'Email removed from the order and moved to the Bin.'} ${clearedSummary(report?.cleared)}` });
      },
      onError: (err) => setBinError(apiErrorInfo(err).message),
    });
  };
  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !writable) return;
    setResult(null);
    const problem = emlFileProblem(file.name, file.size);
    if (problem) { setResult({ message: problem, error: true }); return; }
    let contentBase64: string;
    setReading(true);
    try { contentBase64 = await readAsBase64(file); } catch (e) { setResult({ message: apiErrorInfo(e).message, error: true }); setReading(false); return; }
    setReading(false);
    upload.mutate({ orderId, data: { filename: file.name, contentBase64 } }, {
      onSuccess: (res) => {
        refreshAfterBinChange(client, orderId);
        onSelect(res.emailId);
        setResult({ message: `${file.name} added to the order. ${clearedSummary(res.rebuild?.cleared)}`, warnings: res.warnings });
      },
      onError: (err) => setResult({ message: apiErrorInfo(err).message, error: true }),
    });
  };
  const uploading = reading || upload.isPending;
  return <section className="panel" aria-label="Linked emails" data-testid="section-emails">
    <div className="panel-head"><div><p className="panel-kicker">Source correspondence · newest first</p><h2 className="panel-title">Emails {q.data && <span className="mono count">· {q.data.length}</span>}</h2></div>
      {writable && <><button type="button" className="btn btn-quiet" disabled={uploading} onClick={() => input.current?.click()} data-testid="button-add-email"><MailPlus size={14} />{uploading ? 'Adding email…' : 'Add email'}</button>
        <input ref={input} hidden type="file" accept=".eml,message/rfc822" onChange={(e) => { void pick(e); }} data-testid="input-add-email" /></>}
    </div>
    {writable && <p className="email-upload-help" data-testid="text-email-upload-help">{EML_HELP_TEXT} Maximum 25 MB.</p>}
    {result && <div style={{ padding: '14px 20px 0' }}>
      <Notice message={result.message} error={result.error} onClose={() => setResult(null)} />
      {!!result.warnings?.length && <ul className="email-upload-warnings" role="alert" data-testid="list-email-upload-warnings">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </div>}
    {q.isError ? <QueryError title="Emails could not be loaded" onRetry={() => q.refetch()} /> : q.isLoading ? <SkeletonRows count={3} /> : !emails.length ? <EmptyState title="No linked emails" text="Emails matched to this PO or BK invoice will appear here." /> :
      <div className={`email-layout${selectedId ? ' has-detail' : ''}`}>
        <ul className="email-list" role="list">{emails.map((e) => <li key={e.id}>
          <button type="button" className={`email-row${selectedId === e.id ? ' selected' : ''}`} aria-current={selectedId === e.id} onClick={() => onSelect(e.id)} data-testid={`row-email-${e.id}`}>
            <span className="email-row-top"><strong>{e.subject || '(no subject)'}</strong><time dateTime={e.receivedAt}>{dateTimeText(e.receivedAt)}</time></span>
            <span className="email-row-from">{e.fromName || e.fromAddress}</span>
            <span className="email-row-tags"><span className="type-tag">{humanize(e.category)}</span><span className={`status-pill ${matchClass(e.matchStatus)}`}>{humanize(e.matchStatus)}</span>{e.attachments.length > 0 && <span className="muted-copy"><Paperclip size={11} /> {e.attachments.length}</span>}</span>
          </button>
          {writable && <div className="email-row-actions"><button type="button" className="btn btn-danger-quiet" onClick={() => openRemove({ id: e.id, subject: e.subject || '(no subject)', notThisOrder: e.matchStatus === 'needs_review' })} data-testid={`button-remove-email-${e.id}`}><Trash2 size={12} />{e.matchStatus === 'needs_review' ? 'Not this order' : 'Remove from order'}</button></div>}
          {e.attachments.length > 0 && selectedId !== e.id && <div className="att-list compact">{e.attachments.map((a) => <AttachmentButton key={a.id} orderId={orderId} emailId={e.id} att={a} />)}</div>}
        </li>)}</ul>
        {selectedId && <EmailDetail key={selectedId} orderId={orderId} emailId={selectedId} onClose={() => onSelect(null)} onRemove={openRemove} />}
      </div>}
    {target && <MoveToBinDialog testId="dialog-remove-email" title={target.notThisOrder ? 'Not this order?' : 'Remove this email from the order?'} subject={target.subject} lead={EMAIL_REMOVE_TEXT} confirmLabel={target.notThisOrder ? 'Not this order' : 'Remove from order'} busy={archiveEmail.isPending} error={binError} onConfirm={remove} onClose={() => setTarget(null)} />}
  </section>;
}
