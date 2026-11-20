import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  getListDashboardTemplatesQueryKey, getListDashboardsQueryKey, useDeleteDashboardTemplate, useListDashboardSources,
  useListDashboardTemplates, useSaveDashboardTemplate,
} from '@workspace/api-client-react';
import type { Dashboard, DashboardWidget } from '@workspace/api-client-react';
import { apiErrorInfo } from '@/components/orders/helpers';
import { Notice, QueryError, SkeletonRows, dateText } from '@/components/orders/ui';
import { DEPARTMENTS, EVERYONE, departmentLabel, findTemplate } from './dashboard-model';
import { ConfirmDialog } from './dialogs';
import { LayoutEditor } from './layout-editor';
import './dashboards.css';

const ROWS = [EVERYONE, ...DEPARTMENTS];

/** Manager-only: the parent must mount this only for users who can manage users. */
export function DashboardTemplatesPanel() {
  const client = useQueryClient();
  const templates = useListDashboardTemplates();
  const sources = useListDashboardSources();
  const save = useSaveDashboardTemplate();
  const del = useDeleteDashboardTemplate();
  const [editing, setEditing] = useState<{ department: string; base: Dashboard | undefined; seed: Dashboard | undefined } | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: getListDashboardTemplatesQueryKey() });
    void client.invalidateQueries({ queryKey: getListDashboardsQueryKey() });
  };
  const open = (department: string) => {
    const base = findTemplate(templates.data, department);
    const seed = base ?? (department !== EVERYONE ? findTemplate(templates.data, EVERYONE) : undefined);
    dirtyRef.current = false; setSaveError(null);
    setEditing({ department, base, seed });
  };
  const requestOpen = (department: string) => { if (editing && dirtyRef.current) setPendingSwitch(department); else open(department); };
  const onSave = (name: string, widgets: DashboardWidget[]) => {
    if (!editing) return;
    const dept = editing.department;
    setSaveError(null);
    save.mutate({ department: dept, data: { name, layout: { widgets } } }, {
      onSuccess: (saved) => {
        client.setQueryData<Dashboard[]>(getListDashboardTemplatesQueryKey(), (old) => {
          if (!old) return old;
          const rest = old.filter((t) => t !== findTemplate(old, dept));
          return [...rest, saved];
        });
        refresh(); dirtyRef.current = false; setEditing(null); setNotice(`${departmentLabel(dept)} template saved.`);
      },
      onError: (e) => setSaveError(apiErrorInfo(e).message),
    });
  };
  const onRemove = () => {
    if (!removing) return;
    const dept = removing;
    del.mutate({ department: dept }, {
      onSuccess: () => {
        client.setQueryData<Dashboard[]>(getListDashboardTemplatesQueryKey(), (old) => old?.filter((t) => t !== findTemplate(old, dept)));
        refresh(); setRemoving(null); setRemoveError(null);
        if (editing?.department === dept) { dirtyRef.current = false; setEditing(null); }
        setNotice(`${departmentLabel(dept)} template removed.`);
      },
      onError: (e) => setRemoveError(apiErrorInfo(e).message),
    });
  };
  const everyone = findTemplate(templates.data, EVERYONE);

  return <section className="panel" data-testid="panel-dashboard-templates">
    <div className="panel-head"><div><p className="panel-kicker">Operations desk</p><h2 className="panel-title">Dashboard templates</h2></div><LayoutTemplate size={16} color="#66807e" /></div>
    <div className="dw-tpl-note"><Eye size={15} style={{ flex: 'none', marginTop: 2 }} /><span>A template is the starting dashboard for everyone in a department. People only see the widgets their access allows; anything outside their areas is left out of their view. Staff without a department template get the Everyone template, or the standard layout if none is set.</span></div>
    {notice && <div style={{ padding: '14px 20px 0' }}><Notice message={notice} onClose={() => setNotice(null)} /></div>}
    {templates.isError ? <QueryError onRetry={() => templates.refetch()} detail={apiErrorInfo(templates.error).message} />
      : templates.isLoading ? <SkeletonRows count={6} />
        : editing ? <div style={{ padding: 18 }}>
          <div className="eyebrow">Editing template · {departmentLabel(editing.department)}{editing.department === EVERYONE ? ' (*)' : ''}</div>
          {!editing.base && editing.seed && <p className="dw-hint" style={{ margin: '0 0 10px' }}>Starting from the Everyone template. Saving creates a separate template for this department.</p>}
          <LayoutEditor key={editing.department} initialName={editing.base?.name ?? editing.seed?.name ?? `${departmentLabel(editing.department)} desk`} initialWidgets={(editing.base ?? editing.seed)?.layout.widgets ?? []}
            sources={sources.data} sourcesLoading={sources.isLoading} sourcesError={sources.isError ? apiErrorInfo(sources.error).message : null}
            saving={save.isPending} error={saveError} saveLabel={editing.base ? 'Save template' : 'Create template'} tick={0}
            onSave={onSave} onCancel={() => { dirtyRef.current = false; setEditing(null); }} onDirtyChange={(d) => { dirtyRef.current = d; }} />
        </div>
          : <div>{ROWS.map((dept) => {
            const t = findTemplate(templates.data, dept);
            const fallback = dept === EVERYONE ? 'Standard layout applies' : everyone ? 'Uses the Everyone template' : 'Uses the standard layout';
            return <div key={dept} className={`dw-tpl-row ${dept === EVERYONE ? 'everyone' : ''}`} data-testid={`row-template-${dept === EVERYONE ? 'everyone' : dept}`}>
              <div className="dw-tpl-name">{departmentLabel(dept)}{dept === EVERYONE && <span className="mono" style={{ color: '#a28a50' }}>*</span>}</div>
              <div className="dw-tpl-detail">{t ? <><span className="status-pill blue">{t.name}</span> <span className="mono" style={{ marginLeft: 6 }}>{t.layout.widgets.length} widgets · {dateText(t.updatedAt)}{t.updatedBy ? ` · ${t.updatedBy}` : ''}</span></> : <span className="status-pill neutral">{fallback}</span>}</div>
              <div className="dw-tpl-actions">
                <button type="button" className="btn btn-quiet" onClick={() => requestOpen(dept)} data-testid={`button-edit-template-${dept === EVERYONE ? 'everyone' : dept}`}>{t ? <><Pencil size={13} />Edit</> : <><Plus size={13} />Create</>}</button>
                {t && <button type="button" className="btn btn-quiet" onClick={() => { setRemoveError(null); setRemoving(dept); }} aria-label={`Remove ${departmentLabel(dept)} template`} data-testid={`button-remove-template-${dept === EVERYONE ? 'everyone' : dept}`}><Trash2 size={13} /></button>}
              </div>
            </div>;
          })}</div>}
    {removing && <ConfirmDialog title="Remove template?" body={<>The <strong>{departmentLabel(removing)}</strong> template will be removed. {removing === EVERYONE ? 'Staff without a department template will see the standard layout.' : 'This department will fall back to the Everyone template or the standard layout.'} Personal dashboards are not affected.</>} confirmLabel="Remove template" danger busy={del.isPending} error={removeError} onCancel={() => setRemoving(null)} onConfirm={onRemove} />}
    {pendingSwitch && <ConfirmDialog title="Discard unsaved template?" body="Opening another template will lose your current changes." confirmLabel="Discard and open" danger onCancel={() => setPendingSwitch(null)} onConfirm={() => { const d = pendingSwitch; setPendingSwitch(null); open(d); }} />}
  </section>;
}
