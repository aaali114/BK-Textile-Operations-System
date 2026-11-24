import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import { AlertTriangle, ArrowLeft, Check, Send, Undo2 } from 'lucide-react';
import {
  getGetOrderDocumentQueryKey, getGetOrderQueryKey, useApproveOrderDocument, useGetOrder, useGetOrderDocument, useRequestOrderDocumentChanges,
  useSubmitOrderDocument, useUpdateOrderDocument,
} from '@workspace/api-client-react';
import type { OrderDocument } from '@workspace/api-client-react';
import { Notice, PageFrame, PageHeading, QueryError, SkeletonRows } from '../orders/ui';
import { apiErrorInfo, dateTimeText } from '../orders/helpers';
import { DOC_TYPE_LABELS, formToUpdate, formsEqual, settingsToForm, validateDocForm, type DocForm } from './doc-helpers';
import { refreshDocuments } from './docs-cache';
import { DocDialog, DocStatusBadge, DownloadButtons } from './ui';
import { DocumentPaper } from './DocumentPaper';
import { archivedBannerText } from '../bin/bin-helpers';
import '../bin/bin.css';
import './documents.css';

type Flash = { message: string; error?: boolean } | null;

function Editor({ doc, onSaved, onDirty, onError }: { doc: OrderDocument; onSaved: (d: OrderDocument) => void; onDirty: (dirty: boolean) => void; onError: (m: string) => void }) {
  const update = useUpdateOrderDocument();
  const [original, setOriginal] = useState<DocForm>(() => settingsToForm(doc.settings, doc.data?.sections));
  const [form, setForm] = useState<DocForm>(original);
  const [localError, setLocalError] = useState<string | null>(null);
  const dirty = !formsEqual(form, original);
  const dirtyRef = useRef(onDirty); dirtyRef.current = onDirty;
  useEffect(() => { dirtyRef.current(dirty); }, [dirty]);
  const set = (k: 'allowancePct' | 'pcsPerCarton' | 'previousReference' | 'remarks', v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setSection = (id: string, k: 'description' | 'quality', v: string) => setForm((f) => ({ ...f, sections: { ...f.sections, [id]: { ...(f.sections[id] ?? { description: '', quality: '' }), [k]: v } } }));
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateDocForm(form);
    setLocalError(problem);
    if (problem) return;
    update.mutate({ orderId: doc.orderId, documentId: doc.id, data: formToUpdate(form) }, {
      onSuccess: (saved) => { const next = settingsToForm(saved.settings, saved.data?.sections); setOriginal(next); setForm(next); onSaved(saved); },
      onError: (err) => onError(apiErrorInfo(err).message),
    });
  };
  const cutting = doc.type === 'cutting_program';
  return <form className="panel doc-editor" onSubmit={save} aria-label="Document settings">
    <div className="panel-head"><div><p className="panel-kicker">Draft settings</p><h2 className="panel-title">Edit document</h2></div>{dirty && <span className="status-pill warn" data-testid="text-doc-unsaved">Unsaved</span>}</div>
    <fieldset disabled={update.isPending} className="doc-editor-body">
      {localError && <div className="feedback error" role="alert">{localError}</div>}
      <div className="form-grid">
        <div className="form-field"><label htmlFor="doc-allowance">Allowance %</label><input id="doc-allowance" className="field" type="number" min="0" max="50" step="any" value={form.allowancePct} onChange={(e) => set('allowancePct', e.target.value)} data-testid="input-doc-allowance" /></div>
        <div className="form-field"><label htmlFor="doc-pcs">Pieces per carton <span className="optional-label">Blank = order value</span></label><input id="doc-pcs" className="field" type="number" min="1" max="10000" step="1" value={form.pcsPerCarton} onChange={(e) => set('pcsPerCarton', e.target.value)} data-testid="input-doc-pcs" /></div>
        <div className="form-field full"><label htmlFor="doc-prev">Previous reference</label><input id="doc-prev" className="field" maxLength={120} value={form.previousReference} onChange={(e) => set('previousReference', e.target.value)} data-testid="input-doc-previous" /></div>
        <div className="form-field full"><label htmlFor="doc-remarks">Remarks</label><textarea id="doc-remarks" className="textarea" rows={2} maxLength={500} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} data-testid="input-doc-remarks" /></div>
      </div>
      {(doc.data?.sections ?? []).map((s) => <div key={s.lineId} className="doc-editor-section">
        <div className="form-section-label">{s.finish} · {s.styleNumber}</div>
        <div className="form-field"><label htmlFor={`doc-desc-${s.lineId}`}>Description lines <span className="optional-label">One per row · blank = default</span></label>
          <textarea id={`doc-desc-${s.lineId}`} className="textarea" rows={3} maxLength={600} placeholder={s.descriptionLines.join('\n')} value={form.sections[s.lineId]?.description ?? ''} onChange={(e) => setSection(s.lineId, 'description', e.target.value)} data-testid={`input-doc-description-${s.lineId}`} /></div>
        {cutting && <div className="form-field" style={{ marginTop: 10 }}><label htmlFor={`doc-quality-${s.lineId}`}>Quality line</label>
          <input id={`doc-quality-${s.lineId}`} className="field" maxLength={200} placeholder={s.quality ?? ''} value={form.sections[s.lineId]?.quality ?? ''} onChange={(e) => setSection(s.lineId, 'quality', e.target.value)} data-testid={`input-doc-quality-${s.lineId}`} /></div>}
      </div>)}
      <div className="modal-actions" style={{ marginTop: 6 }}>
        <button type="button" className="btn btn-quiet" disabled={!dirty} onClick={() => { setForm(original); setLocalError(null); }} data-testid="button-doc-discard">Discard changes</button>
        <button type="submit" className="btn btn-primary" disabled={!dirty || update.isPending} data-testid="button-doc-save">{update.isPending ? 'Saving…' : 'Save & refresh preview'}</button>
      </div>
    </fieldset>
  </form>;
}

export function DocumentPage() {
  const { orderId = '', documentId = '' } = useParams<{ orderId: string; documentId: string }>();
  const query = useGetOrderDocument(orderId, documentId, { query: { queryKey: getGetOrderDocumentQueryKey(orderId, documentId), enabled: !!orderId && !!documentId } });
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const submit = useSubmitOrderDocument();
  const approve = useApproveOrderDocument();
  const requestChanges = useRequestOrderDocumentChanges();
  const [flash, setFlash] = useState<Flash>(null);
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<null | 'approve' | 'changes'>(null);
  const [note, setNote] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const orderQuery = useGetOrder(orderId, { query: { queryKey: getGetOrderQueryKey(orderId), enabled: !!orderId } });
  // An order in the Bin is read-only, including documents opened by direct link.
  const order = orderQuery.data;
  const locked = !order || orderQuery.isError || !!order.archivedAt;
  const raw = query.data;
  const doc = raw && (locked || raw.archivedAt) ? { ...raw, canEdit: false, canSubmit: false } : raw;

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const leave = (to: string) => (e: React.MouseEvent) => {
    if (dirty && !window.confirm('You have unsaved document changes. Leave without saving?')) { e.preventDefault(); return; }
    if (dirty) { e.preventDefault(); setDirty(false); setLocation(to); }
  };
  const applied = (saved: OrderDocument, message: string) => { refreshDocuments(client, orderId, saved); setFlash({ message }); };
  const doSubmit = () => doc && submit.mutate({ orderId, documentId }, {
    onSuccess: (saved) => applied(saved, 'Sent for approval. An independent reviewer must now approve it.'),
    onError: (err) => setFlash({ message: apiErrorInfo(err).message, error: true }),
  });
  const openDialog = (k: 'approve' | 'changes') => { setNote(''); setDialogError(null); setDialog(k); };
  const doApprove = () => approve.mutate({ orderId, documentId, data: note.trim() ? { note: note.trim() } : {} }, {
    onSuccess: (saved) => { setDialog(null); applied(saved, 'Document approved. The Excel and PDF originals are now stored permanently.'); },
    onError: (err) => setDialogError(apiErrorInfo(err).message),
  });
  const doRequest = () => {
    if (!note.trim()) { setDialogError('A note is required so the preparer knows what to change.'); return; }
    requestChanges.mutate({ orderId, documentId, data: { note: note.trim() } }, {
      onSuccess: (saved) => { setDialog(null); applied(saved, 'Sent back to the preparer with your note.'); },
      onError: (err) => setDialogError(apiErrorInfo(err).message),
    });
  };

  const orderHref = `/orders/${orderId}`;
  const problems = doc?.data?.problems ?? doc?.problems ?? [];
  const final = doc?.status === 'approved' || doc?.status === 'superseded';
  return <PageFrame>
    <div style={{ marginBottom: 22, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
      <Link href={orderHref} onClick={leave(orderHref)} className="ref-link" data-testid="link-back-order"><ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />Back to order</Link>
    </div>
    {query.isError ? <QueryError title="Could not load this document" detail={apiErrorInfo(query.error).message} onRetry={() => query.refetch()} />
      : query.isLoading || !doc ? <div className="panel"><SkeletonRows /></div> : <>
      <PageHeading eyebrow={`${doc.docNumber} · Revision ${doc.revision}`} title={doc.title || DOC_TYPE_LABELS[doc.type]} subtitle={final ? 'Approved documents are permanent and cannot be edited.' : 'Live data from the order. Drafts download with a DRAFT watermark.'}
        action={<div className="doc-actions"><DocStatusBadge status={doc.status} />{!locked && !doc.archivedAt && <DownloadButtons doc={doc} onError={(m) => setFlash({ message: m, error: true })} />}</div>} />
      {flash && <Notice message={flash.message} error={flash.error} onClose={() => setFlash(null)} />}
      {orderQuery.isError && <QueryError title="Could not verify the order status" detail={apiErrorInfo(orderQuery.error).message} onRetry={() => orderQuery.refetch()} />}
      {order?.archivedAt && <div className="archived-banner" role="status" data-testid="banner-document-order-archived"><div className="archived-copy"><AlertTriangle size={16} /><div>{archivedBannerText(order, dateTimeText)}<small>This document is read-only. Restore the order from the order page or the Bin to work on it.</small></div></div></div>}
      {doc.archivedAt && !locked && <div className="archived-banner" role="status" data-testid="banner-document-archived"><div className="archived-copy"><AlertTriangle size={16} /><div>This document is in the Bin — deleted on {dateTimeText(doc.archivedAt)}<small>Restore it from the Bin to use it again.</small></div></div></div>}
      {doc.outOfDate && <div className="doc-warning" role="alert" data-testid="text-out-of-date"><AlertTriangle size={15} /><span><strong>Out of date.</strong> Order data changed since approval — create a new revision from the order’s Documents tab.</span></div>}
      <div className="doc-layout">
        <div className="doc-main">
          {problems.length > 0 && <div className="doc-problems" role="alert" data-testid="list-doc-problems"><strong>Fix before sending for approval</strong><ul>{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
          {doc.data ? <DocumentPaper data={doc.data} title={doc.title || DOC_TYPE_LABELS[doc.type]} watermark={!final} /> : <div className="panel"><p className="blank-state">No document data is available.</p></div>}
        </div>
        <aside className="doc-side">
          <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Record</p><h2 className="panel-title">Status & people</h2></div></div>
            <dl className="doc-facts stack">
              <div><dt>Prepared by</dt><dd>{doc.preparedBy}</dd></div>
              <div><dt>Contributors</dt><dd>{doc.contributors.length ? doc.contributors.join(', ') : '—'}</dd></div>
              <div><dt>Submitted</dt><dd>{doc.submittedBy ? `${doc.submittedBy} · ${dateTimeText(doc.submittedAt)}` : '—'}</dd></div>
              <div><dt>Reviewed</dt><dd>{doc.reviewedBy ? `${doc.reviewedBy} · ${dateTimeText(doc.reviewedAt)}` : '—'}</dd></div>
              {doc.reviewNote && <div><dt>Review note</dt><dd data-testid="text-review-note">{doc.reviewNote}</dd></div>}
              <div><dt>Template</dt><dd className="mono">{doc.templateVersion}</dd></div>
              {doc.files?.pdfSha256 && <div><dt>PDF SHA-256</dt><dd className="mono doc-hash">{doc.files.pdfSha256}</dd></div>}
              {doc.files?.xlsxSha256 && <div><dt>Excel SHA-256</dt><dd className="mono doc-hash">{doc.files.xlsxSha256}</dd></div>}
            </dl>
          </section>
          {(doc.canEdit || doc.canSubmit) && <section className="panel doc-submit"><div style={{ padding: 18 }}>
            <p className="support-note" style={{ marginTop: 0 }}>{dirty ? 'Save your edits before sending.' : problems.length ? 'Resolve the listed problems first.' : 'A different approver will review it.'}</p>
            <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={!doc.canSubmit || dirty || problems.length > 0 || submit.isPending} onClick={doSubmit} data-testid="button-send-approval"><Send size={14} />{submit.isPending ? 'Sending…' : 'Send for approval'}</button>
          </div></section>}
          {doc.status === 'in_review' && !locked && !doc.archivedAt && <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Four-eyes review</p><h2 className="panel-title">Review</h2></div></div><div style={{ padding: 18, display: 'grid', gap: 9 }}>
            {doc.approvalBlocker ? <p className="doc-blocker" data-testid="text-approval-blocker">{doc.approvalBlocker}</p> : <>
              <button type="button" className="btn btn-primary" onClick={() => openDialog('approve')} data-testid="button-approve"><Check size={14} />Approve</button>
              <button type="button" className="btn btn-quiet" onClick={() => openDialog('changes')} data-testid="button-request-changes"><Undo2 size={14} />Request changes</button>
            </>}
          </div></section>}
          {doc.canEdit && <Editor key={doc.id} doc={doc} onDirty={setDirty} onSaved={(saved) => applied(saved, 'Draft saved. Preview refreshed.')} onError={(m) => setFlash({ message: m, error: true })} />}
        </aside>
      </div>
      {dialog === 'approve' && !locked && !doc.archivedAt && <DocDialog testId="dialog-approve" eyebrow="Irreversible action" title="Approve this document?" onClose={() => setDialog(null)}>
        <p className="doc-confirm"><strong>Approved documents are permanent and cannot be edited.</strong> The final Excel and PDF are stored with fingerprints and any earlier approved revision becomes superseded.</p>
        <div className="form-field"><label htmlFor="approve-note">Note <span className="optional-label">Optional</span></label><textarea id="approve-note" className="textarea" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-approve-note" /></div>
        {dialogError && <div className="feedback error" role="alert" style={{ marginTop: 12, marginBottom: 0 }}>{dialogError}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={() => setDialog(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={approve.isPending} onClick={doApprove} data-testid="button-confirm-approve">{approve.isPending ? 'Approving…' : 'Approve permanently'}</button></div>
      </DocDialog>}
      {dialog === 'changes' && !locked && !doc.archivedAt && <DocDialog testId="dialog-request-changes" eyebrow="Send back" title="Request changes" onClose={() => setDialog(null)}>
        <div className="form-field"><label htmlFor="changes-note">What needs to change? *</label><textarea id="changes-note" className="textarea" rows={4} maxLength={1000} required value={note} onChange={(e) => setNote(e.target.value)} data-testid="input-changes-note" /></div>
        {dialogError && <div className="feedback error" role="alert" style={{ marginTop: 12, marginBottom: 0 }}>{dialogError}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={() => setDialog(null)}>Cancel</button><button type="button" className="btn btn-danger" disabled={requestChanges.isPending || !note.trim()} onClick={doRequest} data-testid="button-confirm-request-changes">{requestChanges.isPending ? 'Sending…' : 'Send back'}</button></div>
      </DocDialog>}
    </>}
  </PageFrame>;
}
