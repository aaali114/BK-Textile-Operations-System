import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import type { OrderDocument } from '@workspace/api-client-react';
import { statusInfo } from './doc-helpers';
import { saveDocumentFile } from './docs-cache';
import { apiErrorInfo } from '../orders/helpers';

export function DocStatusBadge({ status }: { status: string }) {
  const s = statusInfo(status);
  return <span className={`status-pill ${s.tone}`} data-testid={`status-document-${status}`}>{s.label}</span>;
}

/** Body-portalled dialog, so transformed ancestors (page animations) cannot clip it. */
export function DocDialog({ title, eyebrow, onClose, children, testId }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; testId: string }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return createPortal(<div className="modal-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} data-testid={testId} style={{ width: 'min(540px,100%)' }}>
      <div className="modal-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2 id={`${testId}-title`} className="panel-title" style={{ fontSize: 19 }}>{title}</h2></div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={17} /></button></div>
      <div className="modal-content">{children}</div>
    </section>
  </div>, document.body);
}

export function DownloadButtons({ doc, onError }: { doc: OrderDocument; onError: (message: string) => void }) {
  const [busy, setBusy] = useState<null | 'xlsx' | 'pdf'>(null);
  const run = async (format: 'xlsx' | 'pdf') => {
    setBusy(format);
    try { await saveDocumentFile(doc, format); } catch (err) { onError(apiErrorInfo(err).message); } finally { setBusy(null); }
  };
  return <>
    <button type="button" className="btn btn-quiet doc-btn" disabled={!!busy} onClick={() => run('xlsx')} data-testid={`button-download-xlsx-${doc.id}`}><Download size={13} />{busy === 'xlsx' ? 'Preparing…' : 'Download Excel'}</button>
    <button type="button" className="btn btn-quiet doc-btn" disabled={!!busy} onClick={() => run('pdf')} data-testid={`button-download-pdf-${doc.id}`}><Download size={13} />{busy === 'pdf' ? 'Preparing…' : 'Download PDF'}</button>
  </>;
}
