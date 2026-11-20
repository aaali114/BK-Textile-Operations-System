import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Save, X } from 'lucide-react';
import type { Layout } from 'react-grid-layout';
import type { DashboardSource, DashboardWidget } from '@workspace/api-client-react';
import { MAX_WIDGETS, TITLE_MAX, defaultSize, layoutSignature, newWidgetId, nextRow, sanitizeWidgets } from './dashboard-model';
import { DashboardGrid } from './dashboard-grid';
import { ConfirmDialog } from './dialogs';
import { WidgetPicker } from './widget-picker';
import type { WidgetChoice } from './widget-picker';

/** Holds its own draft; parent data refetches never overwrite it (initial props are read once on mount). */
export function LayoutEditor({ initialName, initialWidgets, sources, sourcesLoading, sourcesError, saving, error, saveLabel, tick, onSave, onCancel, onDirtyChange }: {
  initialName: string; initialWidgets: DashboardWidget[]; sources: DashboardSource[] | undefined; sourcesLoading: boolean; sourcesError: string | null;
  saving: boolean; error: string | null; saveLabel: string; tick: number;
  onSave: (name: string, widgets: DashboardWidget[]) => void; onCancel: () => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [baseline] = useState(() => layoutSignature(initialName, initialWidgets));
  const [name, setName] = useState(initialName);
  const [widgets, setWidgets] = useState<DashboardWidget[]>(() => initialWidgets.map((w) => ({ ...w })));
  const [picker, setPicker] = useState<{ editId: string | null } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const dirty = useMemo(() => layoutSignature(name, widgets) !== baseline, [name, widgets, baseline]);
  const dirtyCb = useRef(onDirtyChange);
  dirtyCb.current = onDirtyChange;
  useEffect(() => { dirtyCb.current?.(dirty); }, [dirty]);
  useEffect(() => () => dirtyCb.current?.(false), []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const applyLayout = (layout: Layout) => setWidgets((prev) => {
    let changed = false;
    const next = prev.map((w) => {
      const it = layout.find((l) => l.i === w.id);
      if (!it || (it.x === w.x && it.y === w.y && it.w === w.w && it.h === w.h)) return w;
      changed = true;
      return { ...w, x: it.x, y: it.y, w: it.w, h: it.h };
    });
    return changed ? next : prev;
  });
  const submitWidget = (choice: WidgetChoice) => {
    const editId = picker?.editId;
    setWidgets((prev) => {
      if (editId) return prev.map((w) => (w.id === editId ? { ...w, source: choice.source, viz: choice.viz, title: choice.title, params: choice.params } : w));
      const size = defaultSize(choice.viz);
      return [...prev, { id: newWidgetId(), source: choice.source, viz: choice.viz, title: choice.title, params: choice.params, x: 0, y: nextRow(prev), ...size }];
    });
    setPicker(null);
  };
  const editing = picker?.editId ? widgets.find((w) => w.id === picker.editId) : undefined;
  const removing = removeId ? widgets.find((w) => w.id === removeId) : undefined;
  const nameOk = name.trim().length > 0 && name.trim().length <= TITLE_MAX;

  return <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <div className="dw-editor-bar" data-testid="bar-layout-editor">
      <div className="dw-grow"><label htmlFor="editor-name">Dashboard name</label><input id="editor-name" className="field" maxLength={TITLE_MAX} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-editor-name" /></div>
      <div style={{ display: 'grid', gap: 4 }}><span className="dw-count">{widgets.length}/{MAX_WIDGETS} widgets</span>{dirty ? <span className="dw-dirty" data-testid="status-unsaved">Unsaved changes</span> : <span className="dw-count">No changes</span>}</div>
      <button type="button" className="btn btn-gold" onClick={() => setPicker({ editId: null })} disabled={widgets.length >= MAX_WIDGETS} title={widgets.length >= MAX_WIDGETS ? 'A dashboard holds at most 30 widgets' : undefined} data-testid="button-add-widget"><Plus size={15} />Add widget</button>
      <button type="button" className="btn btn-quiet" onClick={() => (dirty ? setConfirmCancel(true) : onCancel())} data-testid="button-cancel-edit"><X size={15} />Cancel</button>
      <button type="button" className="btn btn-primary" disabled={saving || !nameOk} onClick={() => onSave(name.trim(), sanitizeWidgets(widgets))} data-testid="button-save-dashboard"><Save size={15} />{saving ? 'Saving…' : saveLabel}</button>
    </div>
    {error && <div className="feedback error" role="alert" data-testid="text-save-error">{error}</div>}
    {sourcesError && <div className="feedback error">Data sources could not be loaded: {sourcesError}</div>}
    {widgets.length ? <DashboardGrid widgets={widgets} sources={sources} editing={!saving} tick={tick} onLayout={applyLayout} onEditWidget={(id) => setPicker({ editId: id })} onRemoveWidget={setRemoveId} />
      : <div className="dw-empty"><div className="blank-state"><p className="blank-title">An empty canvas</p><p style={{ fontSize: 12, margin: '0 0 16px' }}>Add widgets from the data sources you can read. Drag the grip to move them and the corner to resize.</p><button type="button" className="btn btn-primary" onClick={() => setPicker({ editId: null })} data-testid="button-add-first-widget"><Plus size={15} />Add widget</button></div></div>}
    {picker && <WidgetPicker key={picker.editId ?? 'new'} sources={sources} sourcesLoading={sourcesLoading} sourcesError={sourcesError} initial={editing} onClose={() => setPicker(null)} onSubmit={submitWidget} />}
    {removing && <ConfirmDialog title="Remove widget?" body={<>Remove <strong>{removing.title || removing.source.replaceAll('_', ' ')}</strong> from this layout. Nothing is saved until you press save.</>} confirmLabel="Remove" danger onCancel={() => setRemoveId(null)} onConfirm={() => { setWidgets((p) => p.filter((w) => w.id !== removing.id)); setRemoveId(null); }} />}
    {confirmCancel && <ConfirmDialog title="Discard changes?" body="Your unsaved layout changes will be lost." confirmLabel="Discard changes" danger onCancel={() => setConfirmCancel(false)} onConfirm={() => { setConfirmCancel(false); onCancel(); }} />}
  </fieldset>;
}
