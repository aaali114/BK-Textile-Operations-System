import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { AlertTriangle, ChevronDown, FileSpreadsheet, FileText, Plus, Trash2 } from 'lucide-react';
import { getListOrderDocumentsQueryKey, useArchiveOrderDocument, useCreateOrderDocument, useListOrderDocuments } from '@workspace/api-client-react';
import type { DocumentType, OrderDocument } from '@workspace/api-client-react';
import { Notice, QueryError, SkeletonRows } from '../orders/ui';
import { apiErrorInfo, dateTimeText } from '../orders/helpers';
import { useAccess } from '../access/AccessProvider';
import { DOC_TYPE_LABELS, canStartRevision, groupDocuments } from './doc-helpers';
import { refreshDocuments } from './docs-cache';
import { DocStatusBadge, DownloadButtons } from './ui';
import { MoveToBinDialog } from '../bin/MoveToBinDialog';
import { APPROVED_DOC_WARNING, archiveBody, canDeleteDocument, isFinalDocument } from '../bin/bin-helpers';
import { refreshAfterBinChange } from '../bin/bin-cache';
import './documents.css';

function Facts({ doc }: { doc: OrderDocument }) {
  return <dl className="doc-facts">
    <div><dt>Revision</dt><dd className="mono" data-testid={`text-revision-${doc.id}`}>{doc.revision}</dd></div>
    <div><dt>Document no.</dt><dd className="mono">{doc.docNumber}</dd></div>
    <div><dt>Prepared by</dt><dd>{doc.preparedBy}</dd></div>
    <div><dt>{doc.status === 'changes_requested' ? 'Returned by' : 'Approved by'}</dt><dd>{doc.reviewedBy ? `${doc.reviewedBy}${doc.reviewedAt ? ` · ${dateTimeText(doc.reviewedAt)}` : ''}` : '—'}</dd></div>
  </dl>;
}

export function DocumentsTab({ orderId }: { orderId: string }) {
  const access = useAccess();
  const canPrepare = access.hasPermission('prepare_documents');
  const query = useListOrderDocuments(orderId, { query: { queryKey: getListOrderDocumentsQueryKey(orderId), enabled: !!orderId } });
  const create = useCreateOrderDocument();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const writable = access.canWrite('merchandising');
  const role = access.user?.role;
  const archiveDoc = useArchiveOrderDocument();
  const [binTarget, setBinTarget] = useState<OrderDocument | null>(null);
  const [binError, setBinError] = useState<string | null>(null);
  const deletable = (d: OrderDocument) => canDeleteDocument(d.status, writable, role);
  const askDelete = (d: OrderDocument) => { setBinError(null); setBinTarget(d); };
  const moveToBin = (reason: string) => {
    if (!binTarget) return;
    const d = binTarget;
    setBinError(null);
    archiveDoc.mutate({ orderId, documentId: d.id, data: archiveBody(reason) }, {
      onSuccess: () => {
        client.setQueryData<OrderDocument[]>(getListOrderDocumentsQueryKey(orderId), (old) => old?.filter((x) => x.id !== d.id));
        refreshAfterBinChange(client, orderId);
        setBinTarget(null);
        setNotice({ message: `${DOC_TYPE_LABELS[d.type]} revision ${d.revision} moved to the Bin.` });
      },
      onError: (err) => setBinError(apiErrorInfo(err).message),
    });
  };
  const start = (type: DocumentType) => {
    setNotice(null);
    create.mutate({ orderId, data: { type } }, {
      onSuccess: (doc) => { refreshDocuments(client, orderId, doc); setLocation(`/orders/${orderId}/documents/${doc.id}`); },
      onError: (err) => setNotice({ message: apiErrorInfo(err).message, error: true }),
    });
  };
  if (query.isError) return <QueryError title="Could not load documents" detail={apiErrorInfo(query.error).message} onRetry={() => query.refetch()} />;
  if (query.isLoading) return <div className="panel"><SkeletonRows count={4} /></div>;
  const groups = groupDocuments(query.data);
  return <div className="spec-stack">
    {notice && <Notice message={notice.message} error={notice.error} onClose={() => setNotice(null)} />}
    {groups.map((g) => {
      const Icon = g.type === 'cutting_program' ? FileSpreadsheet : FileText;
      const doc = g.latest;
      const startable = canPrepare && canStartRevision(g);
      return <section className="panel doc-card" key={g.type} data-testid={`card-document-${g.type}`}>
        <div className="panel-head"><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span className="document-icon"><Icon size={16} /></span><div><p className="panel-kicker">Production document</p><h2 className="panel-title">{DOC_TYPE_LABELS[g.type]}</h2></div></div>{doc && <DocStatusBadge status={doc.status} />}</div>
        {!doc ? <div className="doc-empty"><p>No {DOC_TYPE_LABELS[g.type].toLowerCase()} has been prepared for this order yet.</p>
          {canPrepare ? <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={() => start(g.type)} data-testid={`button-create-${g.type}`}><Plus size={14} />{create.isPending ? 'Creating…' : 'Create'}</button> : <p className="support-note">Preparing documents needs the Prepare documents permission.</p>}</div>
          : <div className="doc-body">
            {doc.outOfDate && <div className="doc-warning" role="alert" data-testid={`text-out-of-date-${doc.id}`}><AlertTriangle size={15} /><span><strong>Out of date.</strong> Order data changed since approval — create a new revision.</span></div>}
            <Facts doc={doc} />
            {doc.status === 'changes_requested' && doc.reviewNote && <p className="doc-note"><strong>Review note:</strong> {doc.reviewNote}</p>}
            <div className="doc-actions">
              <Link href={`/orders/${orderId}/documents/${doc.id}`} className="btn btn-primary doc-btn" data-testid={`link-open-document-${doc.id}`}>Open</Link>
              {!access.locked && <DownloadButtons doc={doc} onError={(m) => setNotice({ message: m, error: true })} />}
              {deletable(doc) && <button type="button" className="btn btn-danger-quiet doc-btn" onClick={() => askDelete(doc)} data-testid={`button-delete-document-${doc.id}`}><Trash2 size={13} />Delete</button>}
              {startable && <button type="button" className="btn btn-quiet doc-btn" disabled={create.isPending} onClick={() => start(g.type)} data-testid={`button-new-revision-${g.type}`}><Plus size={13} />{create.isPending ? 'Creating…' : 'New revision'}</button>}
            </div>
            {g.history.length > 0 && <div className="doc-history">
              <button type="button" className="doc-history-toggle" aria-expanded={!!open[g.type]} onClick={() => setOpen((o) => ({ ...o, [g.type]: !o[g.type] }))} data-testid={`button-history-${g.type}`}><ChevronDown size={14} className={open[g.type] ? 'rot' : ''} />Revision history · {g.history.length}</button>
              {open[g.type] && <ul>{g.history.map((h) => <li key={h.id} data-testid={`row-revision-${h.id}`}>
                <span className="mono">Rev {h.revision}</span><DocStatusBadge status={h.status} />
                <span className="doc-hist-meta">{h.preparedBy}{h.reviewedAt ? ` · ${dateTimeText(h.reviewedAt)}` : ` · ${dateTimeText(h.createdAt)}`}</span>
                <Link href={`/orders/${orderId}/documents/${h.id}`} className="ref-link">Open</Link>
                {deletable(h) && <button type="button" className="trash-btn doc-hist-delete" onClick={() => askDelete(h)} aria-label={`Delete revision ${h.revision}`} title="Move to the Bin" data-testid={`button-delete-document-${h.id}`}><Trash2 size={13} /></button>}
              </li>)}</ul>}
            </div>}
          </div>}
      </section>;
    })}
    {binTarget && <MoveToBinDialog testId="dialog-delete-document" title="Delete this document?" subject={<>{DOC_TYPE_LABELS[binTarget.type]} · <span className="mono">{binTarget.docNumber}</span> · Revision {binTarget.revision}</>} warning={isFinalDocument(binTarget.status) ? APPROVED_DOC_WARNING : undefined} busy={archiveDoc.isPending} error={binError} onConfirm={moveToBin} onClose={() => setBinTarget(null)} />}
  </div>;
}
