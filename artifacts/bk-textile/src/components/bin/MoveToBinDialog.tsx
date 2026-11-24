import { type ReactNode, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { DocDialog } from '../documents/ui';
import { BIN_CONFIRM_TEXT, REASON_MAX, reasonProblem } from './bin-helpers';
import './bin.css';

/** Shared "Move to the Bin" confirmation with an optional reason (max 500). */
export function MoveToBinDialog({ title, subject, lead, warning, confirmLabel = 'Move to the Bin', busy, error, onConfirm, onClose, testId }: {
  title: string; subject?: ReactNode; lead?: ReactNode; warning?: ReactNode; confirmLabel?: string; busy: boolean; error: string | null;
  onConfirm: (reason: string) => void; onClose: () => void; testId: string;
}) {
  const [reason, setReason] = useState('');
  const problem = reasonProblem(reason);
  return <DocDialog testId={testId} eyebrow="Move to the Bin" title={title} onClose={() => { if (!busy) onClose(); }}>
    {subject && <p className="bin-subject" data-testid={`${testId}-subject`}>{subject}</p>}
    {lead && <p className="doc-confirm">{lead}</p>}
    {warning && <div className="doc-warning" role="alert" style={{ marginBottom: 12 }}><AlertTriangle size={15} /><span>{warning}</span></div>}
    <p className="doc-confirm"><strong>{BIN_CONFIRM_TEXT}</strong></p>
    <div className="form-field"><label htmlFor={`${testId}-reason`}>Reason <span className="optional-label">Optional · shown in the Bin</span></label>
      <textarea id={`${testId}-reason`} className="textarea" rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`${testId}-input-reason`} />
      <div className="bin-counter mono">{reason.length} / {REASON_MAX}</div></div>
    {(problem || error) && <div className="feedback error" role="alert" style={{ marginTop: 12, marginBottom: 0 }}>{problem || error}</div>}
    <div className="modal-actions"><button type="button" className="btn btn-quiet" disabled={busy} onClick={onClose} data-testid={`${testId}-cancel`}>Cancel</button>
      <button type="button" className="btn btn-danger" disabled={busy || !!problem} onClick={() => onConfirm(reason)} data-testid={`${testId}-confirm`}><Trash2 size={14} />{busy ? 'Moving…' : confirmLabel}</button></div>
  </DocDialog>;
}
