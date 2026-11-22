import { Link } from 'wouter';
import { getListDocumentsAwaitingApprovalQueryKey, useListDocumentsAwaitingApproval } from '@workspace/api-client-react';
import { EmptyState, PageFrame, PageHeading, QueryError, SkeletonRows } from '../orders/ui';
import { apiErrorInfo, dateTimeText } from '../orders/helpers';
import { useAccess } from '../access/AccessProvider';
import { DOC_TYPE_LABELS } from './doc-helpers';
import { DocStatusBadge } from './ui';
import './documents.css';

export function useApprovalQueue(enabled: boolean) {
  return useListDocumentsAwaitingApproval({ query: { queryKey: getListDocumentsAwaitingApprovalQueryKey(), enabled, refetchInterval: 60_000 } });
}

export function ApprovalQueuePage() {
  const access = useAccess();
  const allowed = access.hasPermission('approve_documents');
  const query = useApprovalQueue(allowed);
  const docs = query.data;
  return <PageFrame>
    <PageHeading eyebrow="Production office · Four-eyes review" title="Awaiting my approval" subtitle="Cutting programs and packing lists sent for approval that you are allowed to review." />
    <section className="panel">
      <div className="panel-head"><div><p className="panel-kicker">Review queue</p><h2 className="panel-title">Documents in review {docs && <span className="mono" style={{ fontSize: 11, color: '#82908a', fontWeight: 400 }}>· {docs.length}</span>}</h2></div></div>
      {!allowed ? <EmptyState title="Approving documents is not part of your access" text="Ask an administrator for the Approve documents permission if your role requires it." />
        : query.isError ? <QueryError detail={apiErrorInfo(query.error).message} onRetry={() => query.refetch()} />
        : query.isLoading ? <SkeletonRows count={4} />
        : !docs?.length ? <EmptyState title="Nothing waiting for you" text="Documents sent for approval will appear here." />
        : <div className="table-scroll"><table className="data-table"><thead><tr><th>Document</th><th>Type</th><th>Revision</th><th>Prepared by</th><th>Submitted</th><th>Status</th></tr></thead>
          <tbody>{docs.map((d) => <tr key={d.id} data-testid={`row-awaiting-${d.id}`}>
            <td><Link href={`/orders/${d.orderId}/documents/${d.id}`} className="ref-link" data-testid={`link-awaiting-${d.id}`}>{d.docNumber}</Link><div style={{ fontSize: 11, marginTop: 3 }}>{d.title}</div></td>
            <td>{DOC_TYPE_LABELS[d.type]}</td><td className="mono">{d.revision}</td><td>{d.preparedBy}</td>
            <td>{d.submittedAt ? `${dateTimeText(d.submittedAt)}${d.submittedBy ? ` · ${d.submittedBy}` : ''}` : '—'}</td><td><DocStatusBadge status={d.status} /></td>
          </tr>)}</tbody></table></div>}
    </section>
  </PageFrame>;
}
