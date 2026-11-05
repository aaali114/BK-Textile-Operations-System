import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation, useParams } from 'wouter';
import {
  Activity, AlertCircle, ArrowLeft, ArrowRight, Boxes, Check, CircleHelp,
  ClipboardCheck, Clock3, Factory, FilePlus2, LayoutDashboard, LogIn, LogOut, Menu, PackageCheck,
  Plus, Search, Shirt, X,
} from 'lucide-react';
import {
  getGetDashboardSummaryQueryKey, getGetInspectionsQueryKey, getGetMaterialsQueryKey,
  getGetOrderActivityQueryKey, getGetOrderQueryKey, getGetOrdersQueryKey, getGetWorkItemsQueryKey, getHealthCheckQueryKey,
  useCreateInspection, useCreateMaterialLot, useCreateOrder, useGetDashboardSummary,
  useGetInspections, useGetMaterials, useGetOrder, useGetOrderActivity, useGetOrders, useGetWorkItems,
  useHealthCheck, useUpdateOrder, useUpdateWorkItem,
} from '@workspace/api-client-react';
import type {
  DashboardSummary, Department, Inspection, InspectionInput, MaterialLot, MaterialLotInput,
  Order, OrderActivity, OrderInput, OrderStatus, Priority, WorkItem, WorkItemStatus,
} from '@workspace/api-client-react';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in the app environment');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#2b6670',
    colorForeground: '#22343b',
    colorMutedForeground: '#657672',
    colorDanger: '#a9453d',
    colorBackground: '#fbfaf6',
    colorInput: '#fffdf8',
    colorInputForeground: '#26393e',
    colorNeutral: '#22343b',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '6px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbfaf6] rounded-xl w-[440px] max-w-full overflow-hidden border border-[#ded8ca] shadow-none',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#22343b] font-semibold',
    headerSubtitle: 'text-[#657672]',
    socialButtonsBlockButtonText: 'text-[#34464a] font-medium',
    formFieldLabel: 'text-[#526360] font-medium',
    footerActionLink: 'text-[#2b6670] font-semibold',
    footerActionText: 'text-[#657672]',
    dividerText: 'text-[#657672]',
    identityPreviewEditButton: 'text-[#2b6670]',
    formFieldSuccessText: 'text-[#38654e]',
    alertText: 'text-[#8f3f36]',
    logoBox: 'flex justify-center',
    logoImage: 'max-h-9',
    socialButtonsBlockButton: 'border border-[#ded8ca] bg-[#f8f6f0] rounded-md',
    formButtonPrimary: 'bg-[#2b6670] text-white rounded-md hover:bg-[#1f515a]',
    formFieldInput: 'border border-[#d9d4c9] bg-[#fffdf8] text-[#26393e] rounded-md',
    footerAction: 'border-t border-[#e5e0d6]',
    dividerLine: 'bg-[#ded8ca]',
    alert: 'bg-[#f5e6e0] border border-[#e8c7ba] text-[#913f36]',
    otpCodeFieldInput: 'border border-[#d9d4c9] bg-[#fffdf8] text-[#26393e] rounded-md',
    formFieldRow: 'text-[#34464a]',
    main: 'text-[#22343b]',
  },
};

const navItems = [
  { href: '/dashboard', label: 'Operations desk', icon: LayoutDashboard },
  { href: '/orders', label: 'Order register', icon: Shirt },
  { href: '/workflows', label: 'Department work', icon: Factory },
  { href: '/materials', label: 'Materials & lots', icon: Boxes },
  { href: '/quality', label: 'Quality inspections', icon: ClipboardCheck },
];

function Brand({ small = false }: { small?: boolean }) {
  return <div className="brand-lockup">
    <div className="brand-mark">BK</div>
    <div><div className="brand-name">B.K. TEXTILE</div>{!small && <div className="brand-sub">OPERATIONS SYSTEM</div>}</div>
  </div>;
}

function SignOutAction() {
  const { signOut } = useClerk();
  return <button type="button" className="btn btn-quiet" style={{ minHeight: 34, padding: '6px 10px' }} onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><LogOut size={14} />Sign out</button>;
}

function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, isLoaded } = useUser();
  const health = useHealthCheck();
  return <div className="app-shell">
    <aside className="sidebar">
      <Brand />
      <div className="nav-label">Production office</div>
      <nav aria-label="Main navigation">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href || (href !== '/' && location.startsWith(href)) ? 'active' : ''}`} data-testid={`link-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></Link>)}
      </nav>
      <div className="sidebar-foot"><span className="status-pill blue"><span className="severity-dot info" />{health.isLoading ? 'Checking service' : health.isError ? 'Service unavailable' : 'Operations service ready'}</span><div style={{ marginTop: 12 }}>Shared daily view for orders, floor work, material lots and quality control.</div></div>
    </aside>
    <div className="main-area">
      <header className="topbar">
        <button className="icon-btn mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(!menuOpen)} data-testid="button-mobile-menu"><Menu size={18} /></button>
        <div className="top-meta">B.K. Textile <span style={{ color: '#c2a45f' }}> / </span> Operations workspace</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div className="top-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className={`severity-dot ${health.isError ? 'critical' : 'info'}`} />{health.isError ? 'Connection issue' : 'Service connected'}</div>
          <div className="signed-user">{isLoaded ? user?.fullName || user?.primaryEmailAddress?.emailAddress : 'Loading profile'}</div>
          <SignOutAction />
        </div>
      </header>
      {menuOpen && <div className="mobile-nav">{navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={location === href ? 'active' : ''} onClick={() => setMenuOpen(false)}><Icon size={18} />{label.split(' ')[0]}</Link>)}</div>}
      {children}
    </div>
  </div>;
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle?: string; action?: React.ReactNode }) {
  return <div className="page-title-row"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1>{subtitle && <p className="page-subtitle">{subtitle}</p>}</div>{action}</div>;
}
function PageFrame({ children }: { children: React.ReactNode }) { return <main className="page-wrap">{children}</main>; }
function Notice({ message, error = false, onClose }: { message: string; error?: boolean; onClose?: () => void }) {
  return <div role={error ? 'alert' : 'status'} className={`feedback ${error ? 'error' : 'success'}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>{message}</span>{onClose && <button onClick={onClose} aria-label="Dismiss message" className="icon-btn" style={{ width: 26, height: 26, border: 0, background: 'transparent' }}><X size={15} /></button>}</div>;
}
function QueryError({ onRetry }: { onRetry: () => void }) {
  return <div className="blank-state"><div className="blank-icon"><AlertCircle size={18} /></div><p className="blank-title">Could not load this view</p><p style={{ fontSize: 12, margin: '0 0 16px' }}>Check the service connection, then try again.</p><button className="btn btn-quiet" onClick={onRetry}>Retry</button></div>;
}
function SkeletonRows({ count = 5 }: { count?: number }) { return <div aria-label="Loading records">{Array.from({ length: count }).map((_, i) => <div key={i} style={{ height: 46, margin: '9px 15px', borderRadius: 4, background: 'linear-gradient(90deg,#efede6,#f7f5ef,#efede6)', backgroundSize: '200% 100%', animation: 'skeleton 1.3s infinite' }} />)}</div>; }
function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) { return <div className="blank-state"><div className="blank-icon"><CircleHelp size={18} /></div><p className="blank-title">{title}</p><p style={{ fontSize: 12, margin: '0 0 16px' }}>{text}</p>{action}</div>; }
function statusLabel(value: string) { return value.replaceAll('_', ' '); }
function StatusPill({ status }: { status: string }) {
  const warn = ['pending_qc', 'development', 'blocked', 'high', 'urgent'].includes(status);
  const danger = ['hold', 'rejected', 'overdue'].includes(status);
  const blue = ['in_production', 'in_progress', 'ready_to_ship', 'accepted', 'available'].includes(status);
  return <span className={`status-pill ${danger ? 'danger' : warn ? 'warn' : blue ? 'blue' : 'neutral'}`}><span className={`severity-dot ${danger ? 'critical' : blue ? 'info' : ''}`} style={{ width: 5, height: 5, margin: 0 }} />{statusLabel(status)}</span>;
}
function DataDisclaimer() { return <div style={{ fontSize: 10, color: '#87918a', marginTop: 12, display: 'flex', gap: 7, alignItems: 'center' }}><AlertCircle size={13} />All records shown are synthetic demonstration data supplied by the backend.</div>; }
function dateText(date?: string | null) { if (!date) return '—'; const parsed = new Date(date); return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
function numberText(value?: number) { return typeof value === 'number' ? value.toLocaleString() : '—'; }
function toInputDate(value?: string) { return value ? value.slice(0, 10) : ''; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }

function PublicHome() {
  return <main className="public-hero">
    <header className="public-top"><Brand /><Link href="/sign-in" className="btn btn-quiet" style={{ background: 'transparent', color: '#f5f1e9', borderColor: '#ffffff45' }}><LogIn size={15} />Sign in</Link></header>
    <section className="hero-body">
      <div><div className="hero-kicker">B.K. Textile · Internal operations</div><h1 className="hero-title">Every order.<br />Every handoff.<br /><span style={{ color: '#dfb760' }}>In view.</span></h1>
        <p className="hero-desc">A shared work system for the daily movement of garment orders—from buyer requirements and department workload to incoming lots and inspection results.</p>
        <div className="hero-ctas"><Link href="/sign-in" className="btn btn-gold">Sign in to operations <ArrowRight size={15} /></Link><Link href="/sign-up" className="btn btn-quiet" style={{ background: 'transparent', color: '#d4dfd9', borderColor: '#ffffff45' }}>Request access</Link></div>
        <p style={{ color: '#93a6a2', fontSize: 11, marginTop: 18 }}>Initial system slice · synthetic demonstration records only</p>
      </div>
      <div className="hero-visual" aria-label="Abstract woven textile swatch illustration"><div className="fabric-lines" /><div className="swatch" /><div className="hero-index">01 / 04 — MATERIAL FLOW</div><div className="visual-label">FROM RECEIPT TO READY-TO-CUT</div></div>
    </section>
    <footer className="hero-foot"><span>Order register</span><span>Department work</span><span>Material lots</span><span>Inspection records</span></footer>
  </main>;
}

function Dashboard() {
  const query = useGetDashboardSummary();
  const summary = query.data as DashboardSummary | undefined;
  const metrics = [
    { label: 'Active orders', value: summary?.activeOrders, note: 'Open across production stages', icon: Shirt },
    { label: 'Due this month', value: summary?.dueThisMonth, note: 'Delivery commitments', icon: Clock3 },
    { label: 'Overdue work', value: summary?.overdueWork, note: 'Department tasks past due', icon: AlertCircle, alert: true },
    { label: 'Materials on hold', value: summary?.materialsOnHold, note: 'Awaiting disposition', icon: PackageCheck, alert: true },
  ];
  const maxTasks = Math.max(1, ...(summary?.departmentPulse ?? []).map((d) => d.openTasks));
  return <PageFrame>
    <PageHeading eyebrow="Production office · Today" title="Operations desk" subtitle="A clear view of the work moving through the factory." action={<Link href="/orders" className="btn btn-primary"><Plus size={16} />Open order register</Link>} />
    {query.isError && <QueryError onRetry={() => query.refetch()} />}
    {query.isLoading ? <><div className="metric-grid">{metrics.map((metric) => <div className="metric" key={metric.label} style={{ height: 119 }} />)}</div><div className="panel"><SkeletonRows /></div></> : summary && <>
      <div className="metric-grid">{metrics.map(({ label, value, note, icon: Icon, alert }) => <div className={`metric ${alert ? 'alert' : ''}`} key={label} data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="metric-label">{label}</span><Icon size={16} color={alert ? '#b75b45' : '#628082'} /></div><div className="metric-value mono">{numberText(value)}</div><div className="metric-note">{note}</div></div>)}</div>
      <div className="dash-grid">
        <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Floor pulse</p><h2 className="panel-title">Department workload</h2></div><Link className="ref-link" href="/workflows">View work queue <ArrowRight size={13} style={{ verticalAlign: 'middle' }} /></Link></div>
          {summary.departmentPulse?.length ? summary.departmentPulse.map((dept) => <div className="dept-row" key={dept.department}><span className="dept-name">{statusLabel(dept.department)}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(4, dept.openTasks / maxTasks * 100)}%` }} /></div><span className="dept-number">{dept.openTasks} open</span><span className="dept-number" style={{ color: dept.overdueTasks ? '#a84c3d' : '#71817c' }}>{dept.overdueTasks} late</span></div>) : <EmptyState title="No department workload yet" text="Work items will appear here when they are added by the operations team." />}
          <div style={{ padding: '12px 20px', borderTop: '1px solid #eeeae1', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#657672' }}><span>Ready to cut</span><strong className="mono">{numberText(summary.readyToCut)} orders</strong></div>
        </section>
        <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
          <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Needs a look</p><h2 className="panel-title">Attention items</h2></div><span className="mono" style={{ fontSize: 11, color: '#71817c' }}>{summary.attentionItems?.length ?? 0}</span></div>
            {summary.attentionItems?.length ? summary.attentionItems.slice(0, 5).map((item) => <div className="attention-row" key={item.id}><span className={`severity-dot ${item.severity}`} /><div><div className="attention-title">{item.title}{item.orderReference && <span className="mono" style={{ marginLeft: 7, color: '#66807e', fontSize: 10 }}>{item.orderReference}</span>}</div><div className="attention-detail">{item.detail}</div></div></div>) : <EmptyState title="Nothing needs escalation" text="Any operational exceptions will be listed here." />}
          </section>
          <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Latest updates</p><h2 className="panel-title">Recent activity</h2></div><Activity size={16} color="#66807e" /></div>
            {summary.recentActivity?.length ? summary.recentActivity.slice(0, 5).map((item) => <div className="activity-item" key={item.id}><span className="activity-mark"><Check size={13} /></span><div><div className="activity-copy"><strong>{item.actor}</strong> {item.description}</div><div className="activity-time">{dateText(item.occurredAt)} · {item.entityType}</div></div></div>) : <EmptyState title="No updates recorded" text="Changes to orders and floor work will be shown here." />}
          </section>
        </div>
      </div>
      <DataDisclaimer />
    </>}
  </PageFrame>;
}

type OrderFormData = Omit<OrderInput, 'orderValue' | 'currencyCode'> & { orderValue: number | null; currencyCode: string | null };
function OrderForm({ onSubmit, busy, initial, onCancel }: { onSubmit: (data: OrderFormData) => void; busy: boolean; initial?: Order; onCancel?: () => void }) {
  const [form, setForm] = useState({ buyer: initial?.buyer ?? '', agencyName: initial?.agencyName ?? '', previousOrderReference: initial?.previousOrderReference ?? '', orderValue: initial?.orderValue?.toString() ?? '', currencyCode: initial?.currencyCode ?? '', poNumber: initial?.poNumber ?? '', style: initial?.style ?? '', description: initial?.description ?? '', quantity: initial?.quantity?.toString() ?? '', deliveryDate: toInputDate(initial?.deliveryDate), priority: initial?.priority ?? 'normal' as Priority });
  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const currencyCode = form.currencyCode.trim().toUpperCase();
    onSubmit({
      buyer: form.buyer.trim(),
      agencyName: form.agencyName.trim(),
      previousOrderReference: form.previousOrderReference.trim(),
      orderValue: form.orderValue.trim() ? Number(form.orderValue) : null,
      currencyCode: currencyCode || null,
      poNumber: form.poNumber.trim(),
      style: form.style.trim(),
      description: form.description.trim(),
      quantity: Number(form.quantity),
      deliveryDate: form.deliveryDate,
      priority: form.priority as Priority,
    });
  };
  return <form onSubmit={submit}><div className="form-grid">
    <div className="form-field"><label htmlFor="order-buyer">Buyer name *</label><input id="order-buyer" className="field" required value={form.buyer} onChange={(e) => set('buyer', e.target.value)} data-testid="input-order-buyer" /></div>
    <div className="form-field"><label htmlFor="order-agency">Agency <span className="optional-label">Optional</span></label><input id="order-agency" className="field" value={form.agencyName} onChange={(e) => set('agencyName', e.target.value)} /></div>
    <div className="form-field"><label htmlFor="order-previous">Previous order reference <span className="optional-label">Optional</span></label><input id="order-previous" className="field" value={form.previousOrderReference} onChange={(e) => set('previousOrderReference', e.target.value)} /></div>
    <div className="form-field"><label htmlFor="order-value">Order value <span className="optional-label">Optional</span></label><div className="currency-input"><input id="order-value" className="field" type="number" min="0" step="0.01" required={!!form.currencyCode} value={form.orderValue} onChange={(e) => set('orderValue', e.target.value)} placeholder="0.00" /><input aria-label="3-letter currency code" className="field currency-code" maxLength={3} minLength={3} pattern="[A-Za-z]{3}" required={!!form.orderValue} value={form.currencyCode} onChange={(e) => set('currencyCode', e.target.value.toUpperCase())} placeholder="USD" /></div></div>
    <div className="form-field"><label htmlFor="order-po">Buyer PO reference</label><input id="order-po" className="field" value={form.poNumber} onChange={(e) => set('poNumber', e.target.value)} /></div>
    <div className="form-field"><label htmlFor="order-style">Style *</label><input id="order-style" className="field" required value={form.style} onChange={(e) => set('style', e.target.value)} /></div>
    <div className="form-field"><label htmlFor="order-qty">Quantity *</label><input id="order-qty" className="field" type="number" min="1" required value={form.quantity} onChange={(e) => set('quantity', e.target.value)} /></div>
    <div className="form-field"><label htmlFor="order-delivery">Delivery date *</label><input id="order-delivery" className="field" type="date" required value={form.deliveryDate} onChange={(e) => set('deliveryDate', e.target.value)} /></div>
    <div className="form-field"><label htmlFor="order-priority">Priority</label><select id="order-priority" className="select" value={form.priority} onChange={(e) => set('priority', e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
    <div className="form-field full"><label htmlFor="order-description">Order notes</label><textarea id="order-description" className="textarea" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
  </div><div className="modal-actions">{onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}<button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Saving…' : initial ? 'Save order changes' : 'Create order'}</button></div></form>;
}
function Orders() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [modal, setModal] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const params = useMemo(() => ({ search: search || undefined, status: status ? status as OrderStatus : undefined }), [search, status]);
  const query = useGetOrders(params);
  const create = useCreateOrder();
  const client = useQueryClient();
  const save = (formData: OrderFormData) => {
    const data: OrderInput = {
      ...formData,
      orderValue: formData.orderValue ?? undefined,
      currencyCode: formData.currencyCode ?? undefined,
    };
    return create.mutate({ data }, {
    onSuccess: () => { void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setNotice({ message: 'Order created and added to the register.' }); setModal(false); },
    onError: (err) => setNotice({ message: errorMessage(err), error: true }),
    });
  };
  const orders = query.data as Order[] | undefined;
  return <PageFrame><PageHeading eyebrow="Production office · Register" title="Order register" subtitle="Buyer commitments, delivery dates and production status in one place." action={<button className="btn btn-primary" onClick={() => { setModal(true); setNotice(null); }} data-testid="button-create-order"><Plus size={16} />Create order</button>} />
    {notice && <Notice message={notice.message} error={notice.error} onClose={() => setNotice(null)} />}
    <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Order book</p><h2 className="panel-title">Orders <span className="mono" style={{ fontSize: 11, color: '#82908a', fontWeight: 400 }}>{orders ? `· ${orders.length}` : ''}</span></h2></div><div className="table-tools">
      <div className="search-field"><Search size={15} /><input className="field" placeholder="Search buyer, style, reference…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search orders" data-testid="input-search-orders" /></div>
      <select className="select" aria-label="Filter by order status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 160 }}><option value="">All statuses</option>{['draft', 'development', 'in_production', 'ready_to_ship', 'shipped'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>
    </div></div>
      {query.isError ? <QueryError onRetry={() => query.refetch()} /> : query.isLoading ? <SkeletonRows /> : !orders?.length ? <EmptyState title={search || status ? 'No matching orders' : 'The order register is clear'} text={search || status ? 'Adjust the search or status filter to see other orders.' : 'Create the first order to begin tracking buyer commitments.'} action={!search && !status ? <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={15} />Create order</button> : undefined} /> :
       <div className="table-scroll"><table className="data-table"><thead><tr><th>Reference / buyer</th><th>Style</th><th>Order value</th><th>Qty</th><th>Delivery</th><th>Priority</th><th>Status</th><th aria-label="Details" /></tr></thead><tbody>{orders.map((order) => <tr key={order.id} data-testid={`row-order-${order.id}`}><td><Link href={`/orders/${order.id}`} className="ref-link">{order.reference}</Link><div style={{ fontSize: 11, color: '#7d8984', marginTop: 4 }}>{order.buyer}{order.poNumber && <span> · PO {order.poNumber}</span>}</div>{(order.agencyName || order.previousOrderReference) && <div className="register-context">{order.agencyName && <span>{order.agencyName}</span>}{order.previousOrderReference && <span>Prev. {order.previousOrderReference}</span>}</div>}</td><td><strong>{order.style}</strong></td><td className="mono">{order.orderValue != null ? `${order.currencyCode || ''} ${Number(order.orderValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim() : '—'}</td><td className="mono">{numberText(order.quantity)}</td><td>{dateText(order.deliveryDate)}</td><td><span className={`priority-marker ${order.priority}`}>{order.priority}</span></td><td><StatusPill status={order.status} /></td><td><Link href={`/orders/${order.id}`} className="ref-link" aria-label={`View ${order.reference}`}><ArrowRight size={16} /></Link></td></tr>)}</tbody></table></div>}
     </section>
    {modal && <div className="modal-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-order-title"><div className="modal-head"><div><div className="eyebrow">New buyer commitment</div><h2 id="create-order-title" className="panel-title" style={{ fontSize: 20 }}>Create order</h2></div><button className="icon-btn" aria-label="Close" onClick={() => setModal(false)}><X size={17} /></button></div><div className="modal-content"><OrderForm onSubmit={save} busy={create.isPending} onCancel={() => setModal(false)} /></div></section></div>}
  </PageFrame>;
}

function OrderDetails() {
  const { orderId = '' } = useParams<{ orderId: string }>();
  const query = useGetOrder(orderId, { query: { queryKey: getGetOrderQueryKey(orderId), enabled: !!orderId } });
  const activityQuery = useGetOrderActivity(orderId, { query: { queryKey: getGetOrderActivityQueryKey(orderId), enabled: !!orderId } });
  const update = useUpdateOrder();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const order = query.data as Order | undefined;
  const save = (input: OrderFormData) => update.mutate({ orderId, data: input }, {
     onSuccess: (saved) => { client.setQueryData(getGetOrderQueryKey(orderId), saved); void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); void client.invalidateQueries({ queryKey: getGetOrderActivityQueryKey(orderId) }); setEditing(false); setNotice({ message: 'Order details saved.' }); },
    onError: (err) => setNotice({ message: errorMessage(err), error: true }),
  });
  const changeStatus = (next: string) => update.mutate({ orderId, data: { status: next as OrderStatus } }, {
     onSuccess: (saved) => { client.setQueryData(getGetOrderQueryKey(orderId), saved); void client.invalidateQueries({ queryKey: getGetOrdersQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); void client.invalidateQueries({ queryKey: getGetOrderActivityQueryKey(orderId) }); setNotice({ message: 'Order status updated.' }); },
    onError: (err) => setNotice({ message: errorMessage(err), error: true }),
  });
  return <PageFrame><div style={{ marginBottom: 22 }}><Link href="/orders" className="ref-link"><ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />Back to order register</Link></div>
    {query.isError ? <QueryError onRetry={() => query.refetch()} /> : query.isLoading ? <div className="panel"><SkeletonRows /></div> : order && <>
      <PageHeading eyebrow={`Order record · ${order.reference}`} title={order.buyer} subtitle={`${order.style}${order.poNumber ? ` · Buyer PO ${order.poNumber}` : ''}`} action={<button className="btn btn-quiet" onClick={() => { setEditing(!editing); setNotice(null); }}><FilePlus2 size={15} />{editing ? 'Cancel edit' : 'Edit order'}</button>} />
      {notice && <Notice message={notice.message} error={notice.error} onClose={() => setNotice(null)} />}
       <section className="panel commercial-record" aria-label="Commercial order record">
         <div className="record-banner"><div><div className="eyebrow">Commercial record</div><div className="record-ref mono">{order.reference}</div></div><div className="record-amount"><span className="detail-label">Order value</span><strong>{order.orderValue != null ? `${order.currencyCode || ''} ${Number(order.orderValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim() : 'Not provided'}</strong></div></div>
         <div className="detail-grid">
           {[
             ['Buyer', order.buyer],
             ['Agency', order.agencyName || 'Not provided'],
             ['Previous order', order.previousOrderReference || 'Not provided'],
             ['Buyer PO', order.poNumber || 'Not provided'],
             ['Style', order.style],
             ['Quantity', numberText(order.quantity)],
             ['Delivery date', dateText(order.deliveryDate)],
             ['Currency', order.currencyCode || 'Not provided'],
             ['Last updated', dateText(order.updatedAt)],
           ].map(([label, value]) => <div className="detail-cell" key={label}><div className="detail-label">{label}</div><div className="detail-value">{value}</div></div>)}
         </div>
       </section>
      <section className="panel" style={{ marginBottom: 18 }}><div className="panel-head"><div><p className="panel-kicker">Production control</p><h2 className="panel-title">Order status & priority</h2></div><StatusPill status={order.status} /></div>
        <div style={{ padding: 20, display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'end' }}><div className="form-field"><label htmlFor="detail-status">Status</label><select id="detail-status" className="select status-select" value={order.status} disabled={update.isPending} onChange={(e) => changeStatus(e.target.value)}>{['draft', 'development', 'in_production', 'ready_to_ship', 'shipped'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></div><div className="form-field"><label>Priority</label><div className={`priority-marker ${order.priority}`}>{order.priority}</div></div><div className="form-field"><label>Created</label><div style={{ fontSize: 12, color: '#5d706c' }}>{dateText(order.createdAt)}</div></div></div>
      </section>
      {editing && <section className="panel" style={{ marginBottom: 18 }}><div className="panel-head"><div><p className="panel-kicker">Editable fields</p><h2 className="panel-title">Update order information</h2></div></div><div style={{ padding: 22 }}><OrderForm initial={order} onSubmit={save} busy={update.isPending} onCancel={() => setEditing(false)} /></div></section>}
       <div className="order-support-grid">
         <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Reference material</p><h2 className="panel-title">Documents</h2></div></div><div className="document-list">
           {['Cutting letter', 'Packing list'].map((name) => <div className="document-row" key={name}><span className="document-icon"><FilePlus2 size={16} /></span><div className="document-copy"><strong>{name}</strong><span>Awaiting your template</span></div><span className="template-status">Template needed</span></div>)}
           <p className="support-note">Document templates have not been provided. No files are stored on this record.</p>
         </div></section>
         <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Style reference</p><h2 className="panel-title">Garment picture</h2></div></div><div className="image-unavailable"><Shirt size={24} strokeWidth={1.5} /><strong>Image storage is not available yet</strong><span>Garment imagery will appear here when image storage is supported.</span></div></section>
       </div>
       <section className="panel order-description"><div className="panel-head"><div><p className="panel-kicker">Production notes</p><h2 className="panel-title">Description</h2></div></div><div className="description-body">{order.description || <span className="muted-copy">No order notes have been added.</span>}</div></section>
       <section className="panel order-activity"><div className="panel-head"><div><p className="panel-kicker">Record history</p><h2 className="panel-title">Order activity</h2></div><Activity size={16} color="#66807e" /></div>
         {activityQuery.isError ? <QueryError onRetry={() => activityQuery.refetch()} /> : activityQuery.isLoading ? <SkeletonRows count={3} /> : (activityQuery.data as OrderActivity[] | undefined)?.length ? <div className="order-timeline">{(activityQuery.data as OrderActivity[]).map((item) => <article className="timeline-entry" key={item.id} data-testid={`activity-${item.id}`}><span className="timeline-node" aria-hidden="true" /><div className="timeline-content"><div className="timeline-top"><strong>{item.actor}</strong><time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></div><p>{item.description}</p></div></article>)}</div> : <EmptyState title="No activity recorded" text="Updates to this order will appear here with the staff member and time." />}
       </section>
    </>}
  </PageFrame>;
}

function Workflows() {
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const params = useMemo(() => ({ department: department ? department as Department : undefined, status: status ? status as WorkItemStatus : undefined }), [department, status]);
  const query = useGetWorkItems(params);
  const update = useUpdateWorkItem();
  const client = useQueryClient();
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const items = query.data as WorkItem[] | undefined;
  const updateField = (item: WorkItem, data: { status?: WorkItemStatus; assignee?: string | null }) => update.mutate({ workItemId: item.id, data }, {
    onSuccess: () => { void client.invalidateQueries({ queryKey: getGetWorkItemsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setNotice({ message: `${item.title} updated.` }); },
    onError: (err) => setNotice({ message: errorMessage(err), error: true }),
  });
  const departments = ['merchandising', 'fabrication', 'sampling', 'accessories', 'greige_warehouse', 'dyed_warehouse', 'cutting', 'embellishment', 'stitching', 'washing', 'finishing', 'packing', 'export', 'accounts', 'admin'];
  return <PageFrame><PageHeading eyebrow="Production office · Work queue" title="Department workload" subtitle="Track each handoff, due date and owner across the production path." />
    {notice && <Notice message={notice.message} error={notice.error} onClose={() => setNotice(null)} />}
    <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Work items</p><h2 className="panel-title">Current department queue {items ? <span className="mono" style={{ fontSize: 11, color: '#82908a', fontWeight: 400 }}>· {items.length}</span> : null}</h2></div><div className="table-tools"><select className="select" value={department} aria-label="Filter department" onChange={(e) => setDepartment(e.target.value)}><option value="">All departments</option>{departments.map((d) => <option value={d} key={d}>{statusLabel(d)}</option>)}</select><select className="select" value={status} aria-label="Filter work status" onChange={(e) => setStatus(e.target.value)}><option value="">All work states</option>{['not_started', 'in_progress', 'blocked', 'completed'].map((s) => <option value={s} key={s}>{statusLabel(s)}</option>)}</select></div></div>
      {query.isError ? <QueryError onRetry={() => query.refetch()} /> : query.isLoading ? <SkeletonRows /> : !items?.length ? <EmptyState title="No work items in this view" text="Try another department or status filter. The queue is populated by operational work items." /> :
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Work item</th><th>Department</th><th>Assignee</th><th>Due date</th><th>Priority</th><th>State</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} data-testid={`row-work-item-${item.id}`}><td><strong>{item.title}</strong><div style={{ marginTop: 4 }}><Link href={`/orders/${item.orderId}`} className="ref-link">{item.orderReference}</Link></div></td><td>{statusLabel(item.department)}</td><td><input className="field" aria-label={`Assignee for ${item.title}`} defaultValue={item.assignee ?? ''} placeholder="Assign owner" style={{ maxWidth: 150, padding: '7px 8px' }} onBlur={(e) => { const next = e.target.value.trim() || null; if (next !== (item.assignee ?? null)) updateField(item, { assignee: next }); }} /></td><td>{dateText(item.dueDate)}</td><td><span className={`priority-marker ${item.priority}`}>{item.priority}</span></td><td><select aria-label={`Status for ${item.title}`} className="select status-select" value={item.status} disabled={update.isPending} onChange={(e) => updateField(item, { status: e.target.value as WorkItemStatus })}>{['not_started', 'in_progress', 'blocked', 'completed'].map((s) => <option value={s} key={s}>{statusLabel(s)}</option>)}</select></td></tr>)}</tbody></table></div>}
    </section><DataDisclaimer />
  </PageFrame>;
}

function MaterialForm({ orders, onSubmit, busy, onCancel }: { orders: Order[]; onSubmit: (data: MaterialLotInput) => void; busy: boolean; onCancel: () => void }) {
  const [form, setForm] = useState({ orderId: '', material: '', type: 'greige_fabric', supplier: '', lotReference: '', quantity: '', unit: 'm', receivedAt: new Date().toISOString().slice(0, 10) });
  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const submit = (event: React.FormEvent) => { event.preventDefault(); onSubmit({ orderId: form.orderId || null, material: form.material.trim(), type: form.type as MaterialLotInput['type'], supplier: form.supplier.trim(), lotReference: form.lotReference.trim(), quantity: Number(form.quantity), unit: form.unit.trim(), receivedAt: new Date(`${form.receivedAt}T12:00:00`).toISOString() }); };
  return <form onSubmit={submit}><div className="form-grid">
    <div className="form-field full"><label htmlFor="material-name">Material description *</label><input id="material-name" className="field" required value={form.material} onChange={(e) => set('material', e.target.value)} placeholder="e.g. 30/1 cotton jersey" /></div>
    <div className="form-field"><label htmlFor="material-type">Material type *</label><select id="material-type" className="select" value={form.type} onChange={(e) => set('type', e.target.value)}>{['yarn', 'greige_fabric', 'dyed_fabric', 'trims'].map((s) => <option value={s} key={s}>{statusLabel(s)}</option>)}</select></div>
    <div className="form-field"><label htmlFor="material-order">Linked order</label><select id="material-order" className="select" value={form.orderId} onChange={(e) => set('orderId', e.target.value)}><option value="">No order link</option>{orders.map((o) => <option key={o.id} value={o.id}>{o.reference} · {o.buyer}</option>)}</select></div>
    <div className="form-field"><label htmlFor="material-supplier">Supplier *</label><input id="material-supplier" className="field" required value={form.supplier} onChange={(e) => set('supplier', e.target.value)} /></div>
    <div className="form-field"><label htmlFor="material-lot">Supplier lot reference *</label><input id="material-lot" className="field" required value={form.lotReference} onChange={(e) => set('lotReference', e.target.value)} /></div>
    <div className="form-field"><label htmlFor="material-quantity">Quantity *</label><input id="material-quantity" className="field" type="number" min=".01" step=".01" required value={form.quantity} onChange={(e) => set('quantity', e.target.value)} /></div>
    <div className="form-field"><label htmlFor="material-unit">Unit *</label><input id="material-unit" className="field" required value={form.unit} onChange={(e) => set('unit', e.target.value)} /></div>
    <div className="form-field full"><label htmlFor="material-received">Received date *</label><input id="material-received" className="field" type="date" required value={form.receivedAt} onChange={(e) => set('receivedAt', e.target.value)} /></div>
  </div><div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record receipt'}</button></div></form>;
}
function Materials() {
  const query = useGetMaterials();
  const ordersQuery = useGetOrders();
  const create = useCreateMaterialLot();
  const client = useQueryClient();
  const [modal, setModal] = useState(false);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const materials = query.data as MaterialLot[] | undefined;
  const orders = ordersQuery.data as Order[] | undefined;
  const filtered = materials?.filter((item) => !filter || item.status === filter);
  const save = (data: MaterialLotInput) => create.mutate({ data }, {
    onSuccess: () => { void client.invalidateQueries({ queryKey: getGetMaterialsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setNotice({ message: 'Material receipt recorded.' }); setModal(false); },
    onError: (err) => setNotice({ message: errorMessage(err), error: true }),
  });
  return <PageFrame><PageHeading eyebrow="Production office · Incoming goods" title="Materials & lots" subtitle="Record receipts and keep each lot traceable through quality disposition." action={<button className="btn btn-primary" onClick={() => { setModal(true); setNotice(null); }}><Plus size={16} />Record receipt</button>} />
    {notice && <Notice message={notice.message} error={notice.error} onClose={() => setNotice(null)} />}
    <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Receiving register</p><h2 className="panel-title">Material lots {materials ? <span className="mono" style={{ fontSize: 11, color: '#82908a', fontWeight: 400 }}>· {materials.length}</span> : null}</h2></div><select className="select" style={{ width: 170 }} aria-label="Filter lots by status" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All lot statuses</option>{['pending_qc', 'available', 'hold', 'rejected'].map((s) => <option value={s} key={s}>{statusLabel(s)}</option>)}</select></div>
      {query.isError ? <QueryError onRetry={() => query.refetch()} /> : query.isLoading ? <SkeletonRows /> : !filtered?.length ? <EmptyState title="No material lots in this view" text={filter ? 'Try another disposition filter.' : 'Record a receipt to begin tracking material lots.'} action={!filter ? <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={15} />Record receipt</button> : undefined} /> :
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Material / lot</th><th>Order</th><th>Type</th><th>Supplier</th><th>Quantity</th><th>Received</th><th>Disposition</th></tr></thead><tbody>{filtered.map((lot) => <tr key={lot.id} data-testid={`row-material-${lot.id}`}><td><strong>{lot.material}</strong><div className="mono" style={{ fontSize: 10, marginTop: 4, color: '#75847e' }}>{lot.lotReference}</div></td><td>{lot.orderReference ? <Link className="ref-link" href={`/orders/${lot.orderId}`}>{lot.orderReference}</Link> : '—'}</td><td>{statusLabel(lot.type)}</td><td>{lot.supplier}</td><td className="mono">{numberText(lot.quantity)} {lot.unit}</td><td>{dateText(lot.receivedAt)}</td><td><StatusPill status={lot.status} /></td></tr>)}</tbody></table></div>}
    </section><DataDisclaimer />
    {modal && <div className="modal-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="receipt-title"><div className="modal-head"><div><div className="eyebrow">Incoming goods</div><h2 id="receipt-title" className="panel-title" style={{ fontSize: 20 }}>Record material receipt</h2></div><button className="icon-btn" aria-label="Close" onClick={() => setModal(false)}><X size={17} /></button></div><div className="modal-content">{ordersQuery.isError ? <QueryError onRetry={() => ordersQuery.refetch()} /> : <MaterialForm orders={orders ?? []} onSubmit={save} busy={create.isPending} onCancel={() => setModal(false)} />}</div></section></div>}
  </PageFrame>;
}

function InspectionForm({ materials, onSubmit, busy, onCancel }: { materials: MaterialLot[]; onSubmit: (data: InspectionInput) => void; busy: boolean; onCancel: () => void }) {
  const [form, setForm] = useState({ materialId: '', inspectionType: 'greige', result: 'accepted', defectCount: '0', notes: '' });
  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  const submit = (event: React.FormEvent) => { event.preventDefault(); onSubmit({ materialId: form.materialId, inspectionType: form.inspectionType as InspectionInput['inspectionType'], result: form.result as InspectionInput['result'], defectCount: Number(form.defectCount), notes: form.notes.trim() || undefined }); };
  return <form onSubmit={submit}><div className="form-grid">
    <div className="form-field full"><label htmlFor="inspection-lot">Material lot *</label><select id="inspection-lot" className="select" required value={form.materialId} onChange={(e) => set('materialId', e.target.value)}><option value="">Select a received lot</option>{materials.map((m) => <option value={m.id} key={m.id}>{m.lotReference} · {m.material}</option>)}</select></div>
    <div className="form-field"><label htmlFor="inspection-type">Inspection type *</label><select id="inspection-type" className="select" value={form.inspectionType} onChange={(e) => set('inspectionType', e.target.value)}>{['greige', 'dyed', 'trims'].map((s) => <option value={s} key={s}>{statusLabel(s)}</option>)}</select></div>
    <div className="form-field"><label htmlFor="inspection-result">Result *</label><select id="inspection-result" className="select" value={form.result} onChange={(e) => set('result', e.target.value)}>{['accepted', 'hold', 'rejected'].map((s) => <option value={s} key={s}>{statusLabel(s)}</option>)}</select></div>
    <div className="form-field"><label htmlFor="inspection-defects">Defect count *</label><input id="inspection-defects" className="field" type="number" min="0" step="1" required value={form.defectCount} onChange={(e) => set('defectCount', e.target.value)} /></div>
    <div className="form-field full"><label htmlFor="inspection-notes">Inspection notes</label><textarea id="inspection-notes" className="textarea" rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
  </div><div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button><button className="btn btn-primary" type="submit" disabled={busy || !materials.length}>{busy ? 'Saving…' : 'Save inspection'}</button></div></form>;
}
function Quality() {
  const query = useGetInspections();
  const materialsQuery = useGetMaterials();
  const create = useCreateInspection();
  const client = useQueryClient();
  const [modal, setModal] = useState(false);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const inspections = query.data as Inspection[] | undefined;
  const materials = materialsQuery.data as MaterialLot[] | undefined;
  const filtered = inspections?.filter((i) => !filter || i.result === filter);
  const materialById = useMemo(() => new Map((materials ?? []).map((m) => [m.id, m])), [materials]);
  const save = (data: InspectionInput) => create.mutate({ data }, {
    onSuccess: () => { void client.invalidateQueries({ queryKey: getGetInspectionsQueryKey() }); void client.invalidateQueries({ queryKey: getGetMaterialsQueryKey() }); void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); setNotice({ message: 'Inspection result saved.' }); setModal(false); },
    onError: (err) => setNotice({ message: errorMessage(err), error: true }),
  });
  return <PageFrame><PageHeading eyebrow="Production office · Quality control" title="Quality inspections" subtitle="Capture incoming-lot inspection results and record disposition clearly." action={<button className="btn btn-primary" onClick={() => { setModal(true); setNotice(null); }}><Plus size={16} />New inspection</button>} />
    {notice && <Notice message={notice.message} error={notice.error} onClose={() => setNotice(null)} />}
    <section className="panel"><div className="panel-head"><div><p className="panel-kicker">Inspection log</p><h2 className="panel-title">Recorded checks {inspections ? <span className="mono" style={{ fontSize: 11, color: '#82908a', fontWeight: 400 }}>· {inspections.length}</span> : null}</h2></div><select className="select" style={{ width: 170 }} aria-label="Filter inspections by result" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All results</option>{['accepted', 'hold', 'rejected'].map((s) => <option value={s} key={s}>{statusLabel(s)}</option>)}</select></div>
      {query.isError ? <QueryError onRetry={() => query.refetch()} /> : query.isLoading ? <SkeletonRows /> : !filtered?.length ? <EmptyState title="No inspections in this view" text={filter ? 'There are no inspections with this result yet.' : 'Log a material check to begin the quality record.'} action={!filter ? <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={15} />New inspection</button> : undefined} /> :
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Lot reference</th><th>Material</th><th>Type</th><th>Result</th><th>Defects</th><th>Notes</th><th>Inspected</th></tr></thead><tbody>{filtered.map((inspection) => <tr key={inspection.id} data-testid={`row-inspection-${inspection.id}`}><td className="mono">{inspection.lotReference}</td><td>{materialById.get(inspection.materialId)?.material ?? 'Material record'}</td><td>{statusLabel(inspection.inspectionType)}</td><td><StatusPill status={inspection.result} /></td><td className="mono">{numberText(inspection.defectCount)}</td><td style={{ maxWidth: 240 }}>{inspection.notes || '—'}</td><td>{dateText(inspection.inspectedAt)}</td></tr>)}</tbody></table></div>}
    </section><DataDisclaimer />
    {modal && <div className="modal-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="inspection-title"><div className="modal-head"><div><div className="eyebrow">Incoming material quality</div><h2 id="inspection-title" className="panel-title" style={{ fontSize: 20 }}>Record inspection</h2></div><button className="icon-btn" aria-label="Close" onClick={() => setModal(false)}><X size={17} /></button></div><div className="modal-content">{materialsQuery.isError ? <QueryError onRetry={() => materialsQuery.refetch()} /> : materialsQuery.isLoading ? <SkeletonRows count={3} /> : !materials?.length ? <EmptyState title="No lots available to inspect" text="Record a material receipt first, then return to quality inspections." action={<Link className="btn btn-quiet" href="/materials">Go to materials</Link>} /> : <InspectionForm materials={materials} onSubmit={save} busy={create.isPending} onCancel={() => setModal(false)} />}</div></section></div>}
  </PageFrame>;
}

function AuthLoading() {
  return <main className="auth-loading" role="status"><Brand /><p>Loading secure operations access…</p></main>;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return isSignedIn ? <Redirect to="/dashboard" /> : <PublicHome />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  return isSignedIn ? <>{children}</> : <Redirect to="/" />;
}

function AuthPage({ signup = false }: { signup?: boolean }) {
  return <main className="auth-page">
    <section className="auth-context">
      <Brand />
      <div style={{ marginTop: 80, position: 'relative', zIndex: 1 }}>
        <div className="hero-kicker">B.K. Textile · Operations access</div>
        <h2 className="display" style={{ fontSize: 'clamp(38px,5vw,64px)', lineHeight: 1, margin: '20px 0', maxWidth: 480 }}>{signup ? 'A shared floor starts with the right people.' : 'Good work starts with a clear handoff.'}</h2>
        <p style={{ color: '#bdcac5', maxWidth: 410, lineHeight: 1.7, fontSize: 14 }}>Order commitments, material control and production work—in one dependable daily system.</p>
      </div>
      <div style={{ marginTop: 'auto', font: '10px var(--app-font-mono)', color: '#a1b4ae' }}>INTERNAL OPERATIONS · B.K. TEXTILE</div>
    </section>
    <section className="auth-form-side">
      <div className="auth-box">
        <Link href="/" className="ref-link"><ArrowLeft size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />Back to B.K. Textile</Link>
        <div style={{ marginTop: 24 }}>
          {signup
            ? <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
            : <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />}
        </div>
        <div style={{ marginTop: 20, paddingTop: 15, borderTop: '1px solid #dfd9cd', color: '#84908a', fontSize: 10 }}>
          <span className="mono">B.K. TEXTILE OPERATIONS</span><br />
          <span style={{ display: 'inline-block', marginTop: 7 }}>Authorized team access · Synthetic demonstration records</span>
        </div>
      </div>
    </section>
  </main>;
}

function SignInPage() { return <AuthPage />; }
function SignUpPage() { return <AuthPage signup />; }

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        client.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);

  return null;
}

function Router() {
  const [location, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    appearance={clerkAppearance}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    localization={{
      signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your B.K. Textile operations account' } },
      signUp: { start: { title: 'Request team access', subtitle: 'Create your authorized operations account' } },
    }}
    routerPush={(to) => setLocation(stripBase(to))}
    routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
  >
    <ClerkQueryClientCacheInvalidator />
    <ErrorBoundary resetKey={location}>
      <Switch>
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/dashboard" component={() => <ProtectedRoute><AppShell><Dashboard /></AppShell></ProtectedRoute>} />
        <Route path="/orders" component={() => <ProtectedRoute><AppShell><Orders /></AppShell></ProtectedRoute>} />
        <Route path="/orders/:orderId" component={() => <ProtectedRoute><AppShell><OrderDetails /></AppShell></ProtectedRoute>} />
        <Route path="/workflows" component={() => <ProtectedRoute><AppShell><Workflows /></AppShell></ProtectedRoute>} />
        <Route path="/materials" component={() => <ProtectedRoute><AppShell><Materials /></AppShell></ProtectedRoute>} />
        <Route path="/quality" component={() => <ProtectedRoute><AppShell><Quality /></AppShell></ProtectedRoute>} />
        <Route path="/" component={HomeRedirect} />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  </ClerkProvider>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
