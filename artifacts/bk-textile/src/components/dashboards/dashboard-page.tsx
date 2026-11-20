import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, LayoutTemplate, Pencil, Plus, RefreshCw, RotateCcw, Settings2, Star, Trash2 } from 'lucide-react';
import {
  getListDashboardsQueryKey, useCreateDashboard, useDeleteDashboard, useListDashboardSources, useListDashboards, useUpdateDashboard,
} from '@workspace/api-client-react';
import type { Dashboard, DashboardList, DashboardWidget } from '@workspace/api-client-react';
import { apiErrorInfo } from '@/components/orders/helpers';
import { EmptyState, Notice, PageFrame, PageHeading, QueryError } from '@/components/orders/ui';
import { MAX_DASHBOARDS, POLL_MS, TEMPLATE_KEY, copyName, departmentLabel, resolveSelection, sanitizeWidgets } from './dashboard-model';
import { DashboardGrid } from './dashboard-grid';
import { ActionMenu, ConfirmDialog, NameDialog } from './dialogs';
import type { MenuAction } from './dialogs';
import { LayoutEditor } from './layout-editor';
import './dashboards.css';

type DialogState =
  | { kind: 'new' } | { kind: 'rename' } | { kind: 'duplicate' } | { kind: 'delete' } | { kind: 'reset' }
  | { kind: 'discard'; next: string | null };

function usePollTick() {
  const [tick, setTick] = useState(0);
  const last = useRef(Date.now());
  useEffect(() => {
    const bump = () => { last.current = Date.now(); setTick((t) => t + 1); };
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') bump(); }, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - last.current >= POLL_MS) bump(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  return [tick, () => { last.current = Date.now(); setTick((t) => t + 1); }] as const;
}

function scopeText(d: Dashboard) {
  if (d.scope === 'user') return d.isDefault ? 'Your default dashboard' : 'Your dashboard';
  if (d.scope === 'department') return `${departmentLabel(d.department)} template`;
  return 'Standard layout';
}

export default function CustomDashboardsPage() {
  const client = useQueryClient();
  const list = useListDashboards();
  const sources = useListDashboardSources();
  const create = useCreateDashboard();
  const update = useUpdateDashboard();
  const remove = useDeleteDashboard();
  const [selected, setSelected] = useState<string | null>(null);
  const [editBase, setEditBase] = useState<Dashboard | null>(null);
  const dirtyRef = useRef(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const [tick, refreshAll] = usePollTick();

  const data = list.data;
  const dashboards = data?.dashboards ?? [];
  const activeKey = resolveSelection(data, selected);
  const active = activeKey === TEMPLATE_KEY ? data?.template : dashboards.find((d) => d.id === activeKey);
  const atLimit = dashboards.length >= MAX_DASHBOARDS;
  const sourcesError = sources.isError ? apiErrorInfo(sources.error).message : null;
  const busy = create.isPending || update.isPending || remove.isPending;

  const patchList = (fn: (l: DashboardList) => DashboardList) => {
    client.setQueryData<DashboardList>(getListDashboardsQueryKey(), (old) => (old ? fn(old) : old));
    void client.invalidateQueries({ queryKey: getListDashboardsQueryKey() });
  };
  const upsert = (saved: Dashboard) => patchList((l) => {
    const exists = l.dashboards.some((d) => d.id === saved.id);
    const next = exists ? l.dashboards.map((d) => (d.id === saved.id ? saved : d)) : [...l.dashboards, saved];
    return { ...l, dashboards: saved.isDefault ? next.map((d) => (d.id === saved.id ? d : { ...d, isDefault: false })) : next };
  });
  const closeDialog = () => { if (busy) return; setDialog(null); setDialogError(null); };
  const stopEditing = () => { setEditBase(null); dirtyRef.current = false; setSaveError(null); };

  const switchTo = (key: string | null) => {
    if (busy) return;
    if (editBase && dirtyRef.current) { setDialog({ kind: 'discard', next: key }); return; }
    stopEditing();
    setSelected(key);
  };

  const saveEdit = (name: string, widgets: DashboardWidget[]) => {
    if (!editBase) return;
    setSaveError(null);
    const onError = (e: unknown) => setSaveError(apiErrorInfo(e).message);
    if (editBase.scope === 'user' && editBase.id) {
      update.mutate({ dashboardId: editBase.id, data: { name, layout: { widgets } } }, {
        onSuccess: (saved) => { upsert(saved); stopEditing(); setNotice({ message: `${saved.name} saved.` }); }, onError,
      });
    } else {
      create.mutate({ data: { name, layout: { widgets }, isDefault: dashboards.length === 0 } }, {
        onSuccess: (saved) => { upsert(saved); stopEditing(); setSelected(saved.id); setNotice({ message: `${saved.name} saved as your own dashboard.` }); }, onError,
      });
    }
  };

  const mutateError = (e: unknown) => setDialogError(apiErrorInfo(e).message);
  const runRename = (name: string) => active?.id && update.mutate({ dashboardId: active.id, data: { name } }, { onSuccess: (s) => { upsert(s); closeDialog(); setNotice({ message: 'Dashboard renamed.' }); }, onError: mutateError });
  const runCreate = (name: string, widgets: DashboardWidget[], thenEdit: boolean) => create.mutate({ data: { name, layout: { widgets }, isDefault: dashboards.length === 0 } }, {
    onSuccess: (s) => { upsert(s); closeDialog(); setSelected(s.id); setNotice({ message: `${s.name} created.` }); if (thenEdit) setEditBase(s); }, onError: mutateError,
  });
  const runDelete = (reset: boolean) => active?.id && remove.mutate({ dashboardId: active.id }, {
    onSuccess: () => {
      const id = active.id;
      patchList((l) => ({ ...l, dashboards: l.dashboards.filter((d) => d.id !== id) }));
      closeDialog(); setSelected(reset ? TEMPLATE_KEY : null);
      setNotice({ message: reset ? 'Your copy was removed. Showing the template.' : 'Dashboard deleted.' });
    }, onError: mutateError,
  });
  const makeDefault = () => active?.id && update.mutate({ dashboardId: active.id, data: { isDefault: true } }, {
    onSuccess: (s) => { upsert(s); setNotice({ message: `${s.name} is now your default.` }); }, onError: (e) => setNotice({ message: apiErrorInfo(e).message, error: true }),
  });

  if (list.isLoading) return <PageFrame><PageHeading eyebrow="Operations desk" title="Loading your dashboard" /><div className="dw-skel" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>{[0, 1, 2, 3].map((i) => <span key={i} style={{ height: 170, borderRadius: 8 }} />)}</div></PageFrame>;
  if (list.isError || !data || !active) return <PageFrame><PageHeading eyebrow="Operations desk" title="Dashboard" /><QueryError onRetry={() => list.refetch()} detail={list.isError ? apiErrorInfo(list.error).message : undefined} /></PageFrame>;

  const isUser = active.scope === 'user' && !!active.id;
  const limitHint = atLimit ? `You already have ${MAX_DASHBOARDS} dashboards. Delete one first.` : undefined;
  const menu: MenuAction[] = isUser ? [
    { label: 'Rename', icon: <Pencil size={14} />, onSelect: () => setDialog({ kind: 'rename' }), testId: 'menu-rename' },
    { label: active.isDefault ? 'Already your default' : 'Make default', icon: <Star size={14} />, onSelect: makeDefault, disabled: active.isDefault || busy, testId: 'menu-make-default' },
    { label: 'Duplicate', icon: <Copy size={14} />, onSelect: () => setDialog({ kind: 'duplicate' }), disabled: atLimit, hint: limitHint, testId: 'menu-duplicate' },
    { label: 'Reset to template', icon: <RotateCcw size={14} />, onSelect: () => setDialog({ kind: 'reset' }), separatorBefore: true, testId: 'menu-reset' },
    { label: 'Delete dashboard', icon: <Trash2 size={14} />, onSelect: () => setDialog({ kind: 'delete' }), danger: true, testId: 'menu-delete' },
  ] : [
    { label: 'Duplicate as my dashboard', icon: <Copy size={14} />, onSelect: () => setDialog({ kind: 'duplicate' }), disabled: atLimit, hint: limitHint, testId: 'menu-duplicate' },
  ];

  const headerActions = editBase ? null : <div className="dw-toolbar">
    <button type="button" className="btn btn-quiet" onClick={refreshAll} data-testid="button-refresh-all"><RefreshCw size={14} />Refresh all</button>
    <button type="button" className="btn btn-primary" onClick={() => { setSaveError(null); setEditBase(active); }} disabled={!isUser && atLimit} title={!isUser ? limitHint : undefined} data-testid="button-customise"><Settings2 size={15} />Customise</button>
    <ActionMenu actions={menu} />
  </div>;

  return <PageFrame>
    <div style={{ position: 'relative', zIndex: 20 }}><PageHeading eyebrow={`Operations desk · ${scopeText(active)}`} title={active.name}
      subtitle={isUser ? 'Your own arrangement of the figures you check every day.' : `The ${active.scope === 'builtin' ? 'standard' : departmentLabel(active.department)} view. Customise it to keep your own copy.`}
      action={headerActions} /></div>
    <nav className="dw-tabs" aria-label="Dashboards">
      <button type="button" className={`dw-tab ${activeKey === TEMPLATE_KEY ? 'active' : ''}`} onClick={() => switchTo(TEMPLATE_KEY)} data-testid="tab-template"><LayoutTemplate size={13} />{data.template.name}<span className="dw-tab-kind">template</span></button>
      {dashboards.map((d) => <button type="button" key={d.id} className={`dw-tab ${activeKey === d.id ? 'active' : ''}`} onClick={() => switchTo(d.id)} data-testid={`tab-dashboard-${d.id}`}>
        {d.isDefault && <Star size={12} fill="#d5a44f" color="#b98a34" aria-label="Default" />}{d.name}</button>)}
      <button type="button" className="dw-tab" onClick={() => setDialog({ kind: 'new' })} disabled={atLimit || !!editBase || busy} title={limitHint} data-testid="button-new-dashboard"><Plus size={13} />New</button>
      <span className="dw-tab-count">{dashboards.length}/{MAX_DASHBOARDS} saved</span>
    </nav>
    {notice && <Notice message={notice.message} error={notice.error} onClose={() => setNotice(null)} />}
    {editBase ? <LayoutEditor key={`${editBase.id ?? 'template'}-${editBase.updatedAt}`} initialName={editBase.name} initialWidgets={editBase.layout.widgets}
      sources={sources.data} sourcesLoading={sources.isLoading} sourcesError={sourcesError} saving={create.isPending || update.isPending} error={saveError} tick={tick}
      saveLabel={editBase.scope === 'user' ? 'Save' : 'Save as my dashboard'} onSave={saveEdit} onCancel={stopEditing} onDirtyChange={(d) => { dirtyRef.current = d; }} />
      : <>
        <div className="dw-meta"><span><strong>{active.layout.widgets.length}</strong> widgets</span><span>Refreshes every 3 minutes while this page is visible</span>{active.updatedBy && <span>Last arranged by <strong>{active.updatedBy}</strong></span>}</div>
        {active.layout.widgets.length ? <DashboardGrid widgets={active.layout.widgets} sources={sources.data} editing={false} tick={tick} />
          : <div className="dw-empty"><EmptyState title="No widgets on this dashboard" text="Customise it to add order, floor, material or quality figures." action={<button type="button" className="btn btn-primary" onClick={() => setEditBase(active)} disabled={!isUser && atLimit}><Settings2 size={15} />Customise</button>} /></div>}
      </>}

    {dialog?.kind === 'new' && <NameDialog title="New dashboard" initial="My desk" confirmLabel="Create and customise" busy={create.isPending} error={dialogError} onCancel={closeDialog} onSubmit={(n) => runCreate(n, [], true)} />}
    {dialog?.kind === 'duplicate' && <NameDialog title="Duplicate dashboard" initial={copyName(active.name)} confirmLabel="Duplicate" busy={create.isPending} error={dialogError} note={`${dashboards.length}/${MAX_DASHBOARDS} used`} onCancel={closeDialog} onSubmit={(n) => runCreate(n, sanitizeWidgets(active.layout.widgets), false)} />}
    {dialog?.kind === 'rename' && <NameDialog title="Rename dashboard" initial={active.name} confirmLabel="Rename" busy={update.isPending} error={dialogError} onCancel={closeDialog} onSubmit={runRename} />}
    {dialog?.kind === 'delete' && <ConfirmDialog title="Delete dashboard?" body={<><strong>{active.name}</strong> and its layout will be permanently removed.</>} confirmLabel="Delete dashboard" danger busy={remove.isPending} error={dialogError} onCancel={closeDialog} onConfirm={() => runDelete(false)} />}
    {dialog?.kind === 'reset' && <ConfirmDialog title="Reset to template?" body={<>Your copy <strong>{active.name}</strong> will be deleted and you will see <strong>{data.template.name}</strong> instead.</>} confirmLabel="Delete my copy" danger busy={remove.isPending} error={dialogError} onCancel={closeDialog} onConfirm={() => runDelete(true)} />}
    {dialog?.kind === 'discard' && <ConfirmDialog title="Discard unsaved layout?" body="You are customising this dashboard. Switching now will lose your changes." confirmLabel="Discard and switch" danger onCancel={closeDialog} onConfirm={() => { const next = dialog.next; closeDialog(); stopEditing(); setSelected(next); }} />}
  </PageFrame>;
}
