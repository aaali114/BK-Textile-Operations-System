import { type ReactNode, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useReapplyOrderEmails } from '@workspace/api-client-react';
import type { ReapplyReport } from '@workspace/api-client-react';
import { apiErrorInfo, dateTimeText, humanize, refreshAfterEmailReapply } from './helpers';
import { Notice } from './ui';

export function ReapplyEmailsAction({ orderId, invoiceAction, disabled = false }: { orderId: string; invoiceAction: ReactNode; disabled?: boolean }) {
  const client = useQueryClient();
  const mutation = useReapplyOrderEmails();
  const [confirming, setConfirming] = useState(false);
  const [report, setReport] = useState<ReapplyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reapply = () => {
    if (mutation.isPending) return;
    setError(null);
    setReport(null);
    mutation.mutate({ orderId }, {
      onSuccess: (result) => {
        setReport(result);
        setConfirming(false);
        refreshAfterEmailReapply(client, orderId);
      },
      onError: (err) => {
        setError(apiErrorInfo(err).message);
        // A failed run may have applied some emails before failing.
        refreshAfterEmailReapply(client, orderId);
      },
    });
  };

  return <div>
    <fieldset disabled={mutation.isPending || confirming} style={{ border: 0, padding: 0, margin: '0 0 12px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    {invoiceAction}
    <button type="button" className="btn btn-quiet" disabled={disabled || mutation.isPending || confirming}
      onClick={() => { setConfirming(true); setError(null); setReport(null); }} data-testid="button-reapply-emails">
      <RotateCcw size={14} />{mutation.isPending ? 'Re-applying emails…' : 'Re-apply emails'}
    </button>
    </fieldset>
    {confirming && <section className="feedback error" aria-label="Confirm re-applying emails" style={{ marginTop: 12 }}>
      <p><strong>Re-apply this order’s stored emails?</strong></p>
      <p>Staff edits to the same fields will be overwritten. Emails are applied oldest first, so the latest email wins.
        Changes are logged. The BK invoice number will not change. This does not read the mailbox.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="btn btn-quiet" disabled={mutation.isPending} onClick={() => { setConfirming(false); setError(null); }}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={mutation.isPending} onClick={reapply} data-testid="button-confirm-reapply-emails">
          {mutation.isPending ? 'Re-applying emails…' : 'Overwrite matching fields and re-apply'}
        </button>
      </div>
    </section>}
    {error && <Notice message={error} error onClose={() => setError(null)} />}
    {report && <section aria-label="Email re-apply report" data-testid="report-reapply-emails" style={{ marginTop: 12 }}>
      <Notice message={`Re-apply completed. ${report.emails.length} email${report.emails.length === 1 ? '' : 's'} processed.`} />
      {!report.emails.length && <p className="support-note">No stored emails were available to re-apply.</p>}
      {report.emails.map((email) => <article key={email.emailId} className="email-detail">
        <h3 className="email-subject">{email.subject || '(no subject)'}</h3>
        <p className="support-note">Original date: {dateTimeText(email.originalDate)} · Previous date: {dateTimeText(email.previousDate)}</p>
        {!email.attachments.length ? <p className="support-note">No attachments.</p> : <ul>
          {email.attachments.map((attachment, index) => <li key={`${attachment.filename}-${index}`} style={{ marginBottom: 8, overflowWrap: 'anywhere' }}>
            <strong>{attachment.filename}</strong> · {humanize(attachment.kind)} · {attachment.changes} change{attachment.changes === 1 ? '' : 's'}
            {attachment.skipped && <p className="support-note">Skipped: {attachment.skipped}</p>}
            {attachment.warnings.map((warning, i) => <p key={i} className="inline-error">Warning: {warning}</p>)}
          </li>)}
        </ul>}
      </article>)}
    </section>}
  </div>;
}
