import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ArrowLeft, ArchiveRestore, FilePlus2, Trash2 } from 'lucide-react';
import { getGetOrderQueryKey, useArchiveOrder, useGetOrder, useRestoreOrder, useUpdateOrder } from '@workspace/api-client-react';
import type { OrderStatus } from '@workspace/api-client-react';
import { Notice, PageFrame, PageHeading, QueryError, SkeletonRows, StatusPill, dateText, numberText, statusLabel } from './ui';
import { OrderForm, type OrderFormResult } from './OrderForm';
import { OrderFilesPanel } from './OrderFilesPanel';
import { BreakdownSection } from './BreakdownSection';
import { FabricsSection, TrimsSection } from './SpecSections';
import { EmailsPanel } from './EmailsPanel';
import { ActivityTimeline } from './ActivityTimeline';
import { OverrideInvoiceAction } from './AdminInvoice';
import { apiErrorInfo, dateTimeText, invoiceDisplay, moneyText, orderSaveErrorText, refreshOrderCore } from './helpers';
import { ReadOnlyScope, useAccess } from '../access/AccessProvider';
import { MoveToBinDialog } from '../bin/MoveToBinDialog';
import { archiveBody, archivedBannerText } from '../bin/bin-helpers';
import { refreshAfterBinChange } from '../bin/bin-cache';
import { DocumentsTab } from '../documents/DocumentsTab';
import { ResponsiblePicker } from '../documents/ResponsiblePicker';

type Tab = 'overview' | 'breakdown' | 'specs' | 'documents' | 'emails' | 'activity';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['breakdown', 'Breakdown'], ['specs', 'Fabrics & trims'], ['documents', 'Documents'], ['emails', 'Emails'], ['activity', 'Change log']];

export function OrderDetails() {
  const access = useAccess();
  const writable = access.canWrite('merchandising');
  const { orderId = '' } = useParams<{ orderId: string }>();
  const query = useGetOrder(orderId, { query: { queryKey: getGetOrderQueryKey(orderId), enabled: !!orderId } });
  const update = useUpdateOrder();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [emailId, setEmailId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const order = query.data;
  const archived = !!order?.archivedAt;
  const editable = writable && !archived;
  const archive = useArchiveOrder();
  const restore = useRestoreOrder();
  const [binOpen, setBinOpen] = useState(false);
  const [binError, setBinError] = useState<string | null>(null);
  const moveToBin = (reason: string) => {
    setBinError(null);
    archive.mutate({ orderId, data: archiveBody(reason) }, {
      onSuccess: (saved) => { client.setQueryData(getGetOrderQueryKey(orderId), saved); refreshAfterBinChange(client, orderId); setBinOpen(false); setEditing(false); setNotice({ message: 'Order moved to the Bin. You can restore it from the Bin or with the Restore button below.' }); },
      onError: (err) => setBinError(apiErrorInfo(err).message),
    });
  };
  const restoreOrder = () => {
    setNotice(null);
    restore.mutate({ orderId }, {
      onSuccess: (saved) => { client.setQueryData(getGetOrderQueryKey(orderId), saved); refreshAfterBinChange(client, orderId); setNotice({ message: 'Order restored from the Bin with its files, emails and documents.' }); },
      onError: (err) => setNotice({ message: apiErrorInfo(err).message, error: true }),
    });
  };
  const openEmail = (id: string) => { setEmailId(id); setTab('emails'); };
  const save = (r: OrderFormResult) => {
    if (r.kind !== 'update' || !editable) return;
    setFormError(null);
    update.mutate({ orderId, data: r.data }, {
      onSuccess: (saved) => { client.setQueryData(getGetOrderQueryKey(orderId), saved); refreshOrderCore(client, orderId); setEditing(false); setNotice({ message: 'Order details saved.' }); },
      onError: (err) => setFormError(orderSaveErrorText(err)),
    });
  };
  const changeStatus = (next: string) => editable && update.mutate({ orderId, data: { status: next as OrderStatus } }, {
    onSuccess: (saved) => { client.setQueryData(getGetOrderQueryKey(orderId), saved); refreshOrderCore(client, orderId); setNotice({ message: 'Order status updated.' }); },
    onError: (err) => setNotice({ message: apiErrorInfo(err).message, error: true }),
  });
  const inv = order ? invoiceDisplay(order) : null;
  const notProvided = 'Not provided';
  return <PageFrame><div style={{ marginBottom: 22 }}><Link href="/orders" className="ref-link"><ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />Back to order register</Link></div>
    {query.isError ? <QueryError title="Could not load this order" onRetry={() => query.refetch()} /> : query.isLoading ? <div className="panel"><SkeletonRows /></div> : order && inv && <>
      <PageHeading eyebrow={`BK invoice ${inv.value} · Buyer PO ${order.poNumber || '—'}`} title={order.buyer} subtitle={`${order.style}${order.endCustomer ? ` · for ${order.endCustomer}` : ''}`} action={editable && <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}><button className="btn btn-quiet" onClick={() => { setEditing(!editing); setNotice(null); setFormError(null); setTab('overview'); }} data-testid="button-edit-order"><FilePlus2 size={15} />{editing ? 'Cancel edit' : 'Edit order'}</button><button className="btn btn-danger-quiet btn" onClick={() => { setBinError(null); setBinOpen(true); }} data-testid="button-delete-order"><Trash2 size={15} />Delete order</button></div>} />
      {notice && <Notice message={notice.message} error={notice.error} onClose={() => setNotice(null)} />}
      {archived && <div className="archived-banner" role="status" data-testid="banner-order-archived">
        <div className="archived-copy"><Trash2 size={16} /><div>{archivedBannerText(order, dateTimeText)}<small>Read-only while in the Bin. Editing, uploads and document actions are switched off.</small></div></div>
        {writable && <button type="button" className="btn btn-primary" disabled={restore.isPending} onClick={restoreOrder} data-testid="button-restore-order"><ArchiveRestore size={15} />{restore.isPending ? 'Restoring…' : 'Restore'}</button>}
      </div>}
      {binOpen && <MoveToBinDialog testId="dialog-delete-order" title="Delete this order?" subject={<><strong className="mono">{inv.value}</strong> · {order.buyer} · PO {order.poNumber || '—'}</>} lead="The order, with its files, emails and documents, leaves the order register." busy={archive.isPending} error={binError} onConfirm={moveToBin} onClose={() => setBinOpen(false)} />}
      <ReadOnlyScope locked={archived}>
      <section className="panel commercial-record" aria-label="Commercial order record">
        <div className="record-banner">
          <div className="record-ids">
            <div><div className="eyebrow">BK invoice{inv.legacy && ' · legacy reference'}</div><div className="record-ref mono" data-testid="text-invoice-ref">{inv.value}</div></div>
            <div><div className="eyebrow">Buyer PO</div><div className="record-ref mono" data-testid="text-po-number">{order.poNumber || '—'}</div></div>
          </div>
          <div className="record-amount"><span className="detail-label">Order value</span><strong>{moneyText(order.orderValue, order.currencyCode) ?? notProvided}</strong></div>
        </div>
        <div className="detail-grid">
          {([
            ['Buyer', order.buyer], ['End customer', order.endCustomer || notProvided], ['Agency', order.agencyName || notProvided],
            ['PO issue date', order.poIssueDate ? dateText(order.poIssueDate) : notProvided], ['Ship date', dateText(order.deliveryDate)], ['PO received', order.poReceivedAt ? dateText(order.poReceivedAt) : notProvided],
            ['Price terms', order.priceTerms || notProvided], ['Payment terms', order.paymentTerms || notProvided], ['Ship via', order.shipVia || notProvided],
            ['Country of origin', order.countryOfOrigin || notProvided], ['Over-shipment tolerance', order.overShipTolerancePct != null ? `${order.overShipTolerancePct}%` : notProvided], ['Quantity', numberText(order.quantity)],
            ['Style', order.style], ['Previous order', order.previousOrderReference || notProvided], ['Last updated', dateText(order.updatedAt)],
            ['Pieces per carton', order.pcsPerCarton != null ? numberText(order.pcsPerCarton) : notProvided], ['Garment description', order.garmentDescription || notProvided],
          ] as [string, string][]).map(([label, value]) => <div className="detail-cell" key={label}><div className="detail-label">{label}</div><div className={`detail-value${value === notProvided ? ' muted-copy' : ''}`}>{value}</div></div>)}
        </div>
      </section>
      <div className="record-tabs" role="tablist" aria-label="Order record sections">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`tabpanel-${id}`} className={`record-tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)} data-testid={`tab-${id}`}>{label}</button>)}
      </div>
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-body">
        {tab === 'overview' && <>
          <section className="panel" style={{ marginBottom: 18 }}><div className="panel-head"><div><p className="panel-kicker">Production control</p><h2 className="panel-title">Order status & priority</h2></div><StatusPill status={order.status} /></div>
            <div style={{ padding: 20, display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'end' }}><div className="form-field"><label htmlFor="detail-status">Status</label>{editable ? <select id="detail-status" className="select status-select" value={order.status} disabled={update.isPending} onChange={(e) => changeStatus(e.target.value)}>{['draft', 'development', 'in_production', 'ready_to_ship', 'shipped'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select> : <span>{statusLabel(order.status)}</span>}</div><div className="form-field"><label>Priority</label><div className={`priority-marker ${order.priority}`}>{order.priority}</div></div><ResponsiblePicker order={order} /><div className="form-field"><label>Created</label><div style={{ fontSize: 12, color: '#5d706c' }}>{dateText(order.createdAt)}</div></div></div>
          </section>
          <OverrideInvoiceAction order={order} />
          {editing && editable && <section className="panel" style={{ marginBottom: 18 }}><div className="panel-head"><div><p className="panel-kicker">Editable fields follow your access · BK invoice is locked</p><h2 className="panel-title">Update order information</h2></div></div><div style={{ padding: 22 }}><OrderForm initial={order} onSubmit={save} busy={update.isPending} error={formError} onCancel={() => setEditing(false)} /></div></section>}
          <OrderFilesPanel orderId={orderId} />
          <section className="panel order-description"><div className="panel-head"><div><p className="panel-kicker">Production notes</p><h2 className="panel-title">Description</h2></div></div><div className="description-body">{order.description || <span className="muted-copy">No order notes have been added.</span>}</div></section>
        </>}
        {tab === 'breakdown' && <BreakdownSection orderId={orderId} />}
        {tab === 'specs' && <div className="spec-stack"><FabricsSection orderId={orderId} onOpenEmail={openEmail} /><TrimsSection orderId={orderId} onOpenEmail={openEmail} /></div>}
        {tab === 'documents' && <DocumentsTab orderId={orderId} />}
        {tab === 'emails' && <EmailsPanel orderId={orderId} selectedId={emailId} onSelect={setEmailId} />}
        {tab === 'activity' && <ActivityTimeline orderId={orderId} onOpenEmail={openEmail} />}
      </div>
      </ReadOnlyScope>
    </>}
  </PageFrame>;
}
