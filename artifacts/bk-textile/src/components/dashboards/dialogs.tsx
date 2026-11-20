import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { MoreHorizontal, X } from 'lucide-react';
import { TITLE_MAX } from './dashboard-model';

export function Modal({ title, eyebrow, onClose, children, wide }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return createPortal(<div className="modal-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(680px,100%)' } : undefined}>
      <div className="modal-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2 className="panel-title" style={{ fontSize: 19 }}>{title}</h2></div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} data-testid="button-close-dialog"><X size={17} /></button></div>
      <div className="modal-content">{children}</div>
    </section>
  </div>, document.body);
}

export function ConfirmDialog({ title, body, confirmLabel, danger, busy, error, onConfirm, onCancel }: {
  title: string; body: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; error?: string | null; onConfirm: () => void; onCancel: () => void;
}) {
  return <Modal title={title} eyebrow="Please confirm" onClose={onCancel}>
    <div style={{ fontSize: 13, color: '#4a5d5f', lineHeight: 1.6 }}>{body}</div>
    {error && <div className="feedback error" style={{ marginTop: 14, marginBottom: 0 }}>{error}</div>}
    <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={onCancel} data-testid="button-confirm-cancel">Keep</button>
      <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={onConfirm} data-testid="button-confirm">{busy ? 'Working…' : confirmLabel}</button></div>
  </Modal>;
}

export function NameDialog({ title, initial, confirmLabel, busy, error, note, onSubmit, onCancel }: {
  title: string; initial: string; confirmLabel: string; busy?: boolean; error?: string | null; note?: string; onSubmit: (name: string) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const valid = name.trim().length > 0 && name.trim().length <= TITLE_MAX;
  return <Modal title={title} eyebrow="Dashboard" onClose={onCancel}>
    <form onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(name.trim()); }}>
      <div className="form-field"><label htmlFor="dashboard-name">Dashboard name *</label>
        <input id="dashboard-name" className="field" autoFocus maxLength={TITLE_MAX} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-dashboard-name" />
        <div className="dw-hint">{name.trim().length}/{TITLE_MAX}{note ? ` · ${note}` : ''}</div></div>
      {error && <div className="feedback error" style={{ marginTop: 14, marginBottom: 0 }}>{error}</div>}
      <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!valid || busy} data-testid="button-submit-name">{busy ? 'Saving…' : confirmLabel}</button></div>
    </form>
  </Modal>;
}

export type MenuAction = { label: string; icon: ReactNode; onSelect: () => void; disabled?: boolean; danger?: boolean; hint?: string; separatorBefore?: boolean; testId: string };

export function ActionMenu({ actions, label = 'More actions' }: { actions: MenuAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return <div className="dw-menu" ref={ref}>
    <button type="button" className="btn btn-quiet" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="button-dashboard-menu"><MoreHorizontal size={15} />{label}</button>
    {open && <div className="dw-menu-list" role="menu">{actions.map((a) => <div key={a.testId}>
      {a.separatorBefore && <div className="dw-menu-sep" />}
      <button type="button" role="menuitem" className={`dw-menu-item ${a.danger ? 'danger' : ''}`} disabled={a.disabled} title={a.hint} onClick={() => { setOpen(false); a.onSelect(); }} data-testid={a.testId}>{a.icon}{a.label}</button>
    </div>)}</div>}
  </div>;
}
