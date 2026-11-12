import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowRight, Plus, Search, X } from 'lucide-react';
import { getGetDashboardSummaryQueryKey, getGetInvoiceCounterQueryKey, getGetOrdersQueryKey, useCreateOrder, useGetOrders } from '@workspace/api-client-react';
import type { OrderStatus } from '@workspace/api-client-react';
import { EmptyState, Notice, PageFrame, PageHeading, QueryError, SkeletonRows, StatusPill, dateText, numberText, statusLabel } from './ui';
import { OrderForm, type OrderFormResult } from './OrderForm';
import { InvoiceNumberingPanel } from './AdminInvoice';
import { invoiceDisplay, moneyText, orderSaveErrorText } from './helpers';

export function Orders() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const params = useMemo(() => ({ search: search || undefined, status: status ? status as OrderStatus : undefined }), [search, status]);
  const query = useGetOrders(params);
  const create = useCreateOrder();
  const client = useQueryClient();
  const open = () => { setModal(true); setNotice(null); setFormError(null); };
  const save = (r: OrderFormResult) => {
    if (r.kind !== 'create') return;
    setFormError(null);
    create.mutate({ data: r.data }, {
      onSuccess: (saved) => {
        void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() });
        void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void client.invalidateQueries({ queryKey: getGetInvoiceCounterQueryKey() });
        setNotice({ message: `Order created. BK invoice ${saved.invoiceRef ?? saved.reference} · Buyer PO ${saved.poNumber ?? '—'}.` });
        setModal(false);
      },
      onError: (err) => setFormError(orderSaveErrorText(err)),
    });
  };
  const orders = query.data;
  return <PageFrame><PageHeading eyebrow="Production office · Register" title="Order register" subtitle="Buyer POs, BK invoices, delivery dates and production status in one place." action={<button className="btn btn-primary" onClick={open} data-testid="button-create-order"><Plus size={16} />Create order</button>} />
    {notice && <Notice message={notice.message} error={notice.error} onClose={() => setNotice(null)} />}
    <InvoiceNumberingPanel />
    <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Order book</p><h2 className="panel-title">Orders <span className="mono" style={{ fontSize: 11, color: '#82908a', fontWeight: 400 }}>{orders ? `· ${orders.length}` : ''}</span></h2></div><div className="table-tools">
      <div className="search-field"><Search size={15} /><input className="field" placeholder="Search buyer, PO, invoice, style…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search orders" data-testid="input-search-orders" /></div>
      <select className="select" aria-label="Filter by order status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}><option value="">All statuses</option>{['draft', 'development', 'in_production', 'ready_to_ship', 'shipped'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
    </div></div>
      {query.isError ? <QueryError title="Could not load the order register" onRetry={() => query.refetch()} /> : query.isLoading ? <SkeletonRows /> : !orders?.length ? <EmptyState title={search || status ? 'No matching orders' : 'The order register is clear'} text={search || status ? 'Adjust the search or status filter to see other orders.' : 'Create the first order to begin tracking buyer commitments.'} action={!search && !status ? <button className="btn btn-primary" onClick={open}><Plus size={15} />Create order</button> : undefined} /> :
        <div className="table-scroll"><table className="data-table"><thead><tr><th>BK invoice / buyer PO</th><th>Buyer</th><th>Style</th><th>Order value</th><th>Qty</th><th>Ship date</th><th>Priority</th><th>Status</th><th aria-label="Details" /></tr></thead><tbody>{orders.map((order) => {
          const inv = invoiceDisplay(order);
          return <tr key={order.id} data-testid={`row-order-${order.id}`}>
            <td><Link href={`/orders/${order.id}`} className="ref-link" data-testid={`link-order-${order.id}`}>{inv.value}</Link>{inv.legacy && <span className="legacy-tag">legacy ref</span>}<div className="register-po mono">PO {order.poNumber || '—'}</div></td>
            <td>{order.buyer}{(order.agencyName || order.previousOrderReference || order.endCustomer) && <div className="register-context">{order.endCustomer && <span>For {order.endCustomer}</span>}{order.agencyName && <span>{order.agencyName}</span>}{order.previousOrderReference && <span>Prev. {order.previousOrderReference}</span>}</div>}</td>
            <td><strong>{order.style}</strong></td>
            <td className="mono">{moneyText(order.orderValue, order.currencyCode) ?? '—'}</td>
            <td className="mono">{numberText(order.quantity)}</td><td>{dateText(order.deliveryDate)}</td>
            <td><span className={`priority-marker ${order.priority}`}>{order.priority}</span></td><td><StatusPill status={order.status} /></td>
            <td><Link href={`/orders/${order.id}`} className="ref-link" aria-label={`View ${inv.value}`}><ArrowRight size={16} /></Link></td></tr>;
        })}</tbody></table></div>}
    </section>
    {modal && <div className="modal-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !create.isPending) setModal(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-order-title"><div className="modal-head"><div><div className="eyebrow">New buyer PO · BK invoice assigned on save</div><h2 id="create-order-title" className="panel-title" style={{ fontSize: 20 }}>Create order</h2></div><button className="icon-btn" aria-label="Close" onClick={() => setModal(false)}><X size={17} /></button></div><div className="modal-content"><OrderForm onSubmit={save} busy={create.isPending} error={formError} onCancel={() => setModal(false)} /></div></section></div>}
  </PageFrame>;
}
