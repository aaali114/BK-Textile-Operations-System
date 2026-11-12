import { Activity, Mail } from 'lucide-react';
import { getGetOrderActivityQueryKey, useGetOrderActivity } from '@workspace/api-client-react';
import type { ActivitySource } from '@workspace/api-client-react';
import { EmptyState, QueryError, SkeletonRows } from './ui';
import { changeValueText, dateTimeText, humanize, readChanges } from './helpers';

const SOURCE: Record<ActivitySource, string> = { staff: 'Staff', email_intake: 'Email intake', system: 'System' };

export function ActivityTimeline({ orderId, onOpenEmail }: { orderId: string; onOpenEmail: (id: string) => void }) {
  const q = useGetOrderActivity(orderId, { query: { queryKey: getGetOrderActivityQueryKey(orderId), enabled: !!orderId } });
  return <section className="panel order-activity" aria-label="Change log" data-testid="section-activity">
    <div className="panel-head"><div><p className="panel-kicker">Record history</p><h2 className="panel-title">Change log</h2></div><Activity size={16} color="#66807e" /></div>
    {q.isError ? <QueryError title="Change log could not be loaded" onRetry={() => q.refetch()} /> : q.isLoading ? <SkeletonRows count={3} /> : !q.data?.length ? <EmptyState title="No activity recorded" text="Updates to this order will appear here with who made them and when." /> :
      <div className="order-timeline">{q.data.map((item) => {
        const changes = readChanges(item.details);
        return <article className="timeline-entry" key={item.id} data-testid={`activity-${item.id}`}><span className={`timeline-node src-${item.source}`} aria-hidden="true" /><div className="timeline-content">
          <div className="timeline-top"><span><span className={`source-badge src-${item.source}`}>{SOURCE[item.source] ?? humanize(item.source)}</span> <strong>{item.actor}</strong></span><time dateTime={item.occurredAt}>{dateTimeText(item.occurredAt)}</time></div>
          <p>{item.description}</p>
          {changes.length > 0 && <ul className="change-list">{changes.map((c, i) => <li key={`${c.field}-${i}`}><span className="mono change-field">{humanize(c.field)}:</span> <span className="change-from">{changeValueText(c.from)}</span> <span aria-label="changed to">→</span> <span className="change-to">{changeValueText(c.to)}</span></li>)}</ul>}
          {item.sourceEmailId && <button type="button" className="link-btn" onClick={() => onOpenEmail(item.sourceEmailId as string)} data-testid={`link-activity-email-${item.id}`}><Mail size={12} /> View source email</button>}
        </div></article>;
      })}</div>}
  </section>;
}
