import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useRunEmailIntake } from '@workspace/api-client-react';
import type { IntakeRunSummary } from '@workspace/api-client-react';
import { useAccess } from '../access/AccessProvider';
import { apiErrorInfo, dateTimeText, humanize } from './helpers';
import { Notice } from './ui';

export function EmailIntakePanel() {
  return useAccess().hasPermission('intake_run') ? <IntakeControls /> : null;
}

function IntakeControls() {
  const client = useQueryClient();
  const run = useRunEmailIntake();
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<IntakeRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void client.invalidateQueries({ predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === 'string' && (key.startsWith('/api/orders') || key === '/api/dashboard/summary' || key === '/api/admin/invoice-counter');
    } });
  };
  const read = (dryRun: boolean) => {
    if (run.isPending) return;
    setError(null); setReport(null);
    run.mutate({ data: { dryRun } }, {
      onSuccess: (summary) => { setReport(summary); setConfirming(false); if (!dryRun) refresh(); },
      onError: (err) => { setError(apiErrorInfo(err).message); if (!dryRun) refresh(); },
    });
  };
  return <section className="panel" aria-label="Read mailbox" style={{ marginBottom: 18 }} data-testid="panel-email-intake">
    <div className="panel-head"><div><p className="panel-kicker">Email intake permission</p><h2 className="panel-title">Buyer email intake</h2></div><Mail size={16} /></div>
    <div style={{ padding: 20 }}>
      <p className="support-note">Preview incoming buyer emails or ask the server to import them. Only approved orders are processed; the mailbox is not modified.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-quiet" disabled={run.isPending || confirming} onClick={() => read(true)} data-testid="button-preview-mailbox">Preview (dry run)</button>
        <button type="button" className="btn btn-primary" disabled={run.isPending || confirming} onClick={() => { setConfirming(true); setError(null); }} data-testid="button-read-mailbox">Read mailbox</button>
      </div>
      {run.isPending && <p role="status">Reading emails… This may take a moment.</p>}
      {confirming && <div className="feedback error" style={{ marginTop: 12 }}>
        <p>This will store matching emails and apply their details to orders. Staff edits to the same fields may be overwritten; the latest email wins.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-quiet" disabled={run.isPending} onClick={() => setConfirming(false)} data-testid="button-cancel-mailbox">Cancel</button>
          <button type="button" className="btn btn-primary" disabled={run.isPending} onClick={() => read(false)} data-testid="button-confirm-mailbox">{run.isPending ? 'Reading…' : 'Read and apply emails'}</button>
        </div>
      </div>}
      {error && <Notice message={error} error />}
      {report && <div style={{ marginTop: 16 }} data-testid="report-mailbox">
        <Notice message={`${report.dryRun ? 'Preview only — no data saved.' : 'Mailbox run completed.'} Scanned: ${report.scanned}; candidates: ${report.candidates}; stored: ${report.stored}; duplicates: ${report.duplicates}; skipped: ${report.skipped}.`} />
        {report.errors.map((err, i) => <p key={i} role="alert" className="inline-error">{err}</p>)}
        {!report.emails.length && <p className="support-note">No matching email results.</p>}
        {report.emails.map((email) => <article className="email-detail" key={email.uid}>
          <h3 className="email-subject">{email.subject || '(no subject)'}</h3>
          <p>{dateTimeText(email.date)} · {humanize(email.outcome)}</p>
          {email.error && <p role="alert" className="inline-error">{email.error}</p>}
          {email.orders.map((order, i) => <p key={i}>PO {order.poNumber ?? '—'} · BK invoice {order.invoiceRef ?? '—'} · {humanize(order.matchStatus)}{order.created ? ' · new order' : ''}</p>)}
          <ul>{email.attachments.map((attachment, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>
            {attachment.filename} · {humanize(attachment.kind)} · {attachment.changes} changes
            {attachment.skipped && <p>Skipped: {attachment.skipped}</p>}
            {attachment.warnings.map((warning, j) => <p key={j} className="inline-error">Warning: {warning}</p>)}
          </li>)}</ul>
        </article>)}
      </div>}
    </div>
  </section>;
}
