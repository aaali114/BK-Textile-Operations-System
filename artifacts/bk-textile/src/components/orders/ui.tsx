import type { ReactNode } from 'react';
import { AlertCircle, CircleHelp, X } from 'lucide-react';
export function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-title-row"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1>{subtitle && <p className="page-subtitle">{subtitle}</p>}</div>{action}</div>;
}
export function PageFrame({ children }: { children: ReactNode }) { return <main className="page-wrap">{children}</main>; }
export function Notice({ message, error = false, onClose }: { message: string; error?: boolean; onClose?: () => void }) {
  return <div role={error ? 'alert' : 'status'} className={`feedback ${error ? 'error' : 'success'}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>{message}</span>{onClose && <button onClick={onClose} aria-label="Dismiss message" className="icon-btn" style={{ width: 26, height: 26, border: 0, background: 'transparent' }}><X size={15} /></button>}</div>;
}
export function QueryError({ onRetry, title = 'Could not load this view', detail }: { onRetry: () => void; title?: string; detail?: string }) {
  return <div className="blank-state" role="alert"><div className="blank-icon"><AlertCircle size={18} /></div><p className="blank-title">{title}</p><p style={{ fontSize: 12, margin: '0 0 16px' }}>{detail ?? 'Check the service connection, then try again.'}</p><button className="btn btn-quiet" onClick={onRetry}>Retry</button></div>;
}
export function SkeletonRows({ count = 5 }: { count?: number }) { return <div aria-label="Loading records">{Array.from({ length: count }).map((_, i) => <div key={i} style={{ height: 46, margin: '9px 15px', borderRadius: 4, background: 'linear-gradient(90deg,#efede6,#f7f5ef,#efede6)', backgroundSize: '200% 100%', animation: 'skeleton 1.3s infinite' }} />)}</div>; }
export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) { return <div className="blank-state"><div className="blank-icon"><CircleHelp size={18} /></div><p className="blank-title">{title}</p><p style={{ fontSize: 12, margin: '0 0 16px' }}>{text}</p>{action}</div>; }
export function statusLabel(value: string) { return value.replaceAll('_', ' '); }
export function StatusPill({ status }: { status: string }) {
  const warn = ['pending_qc', 'development', 'blocked', 'high', 'urgent'].includes(status);
  const danger = ['hold', 'rejected', 'overdue'].includes(status);
  const blue = ['in_production', 'in_progress', 'ready_to_ship', 'accepted', 'available'].includes(status);
  return <span className={`status-pill ${danger ? 'danger' : warn ? 'warn' : blue ? 'blue' : 'neutral'}`}><span className={`severity-dot ${danger ? 'critical' : blue ? 'info' : ''}`} style={{ width: 5, height: 5, margin: 0 }} />{statusLabel(status)}</span>;
}
export function dateText(date?: string | null) { if (!date) return '—'; const parsed = new Date(date); return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
export function numberText(value?: number) { return typeof value === 'number' ? value.toLocaleString() : '—'; }
export function toInputDate(value?: string) { return value ? value.slice(0, 10) : ''; }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
