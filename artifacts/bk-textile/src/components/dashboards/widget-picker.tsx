import { useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Hash, LineChart, PieChart, Search, Table2 } from 'lucide-react';
import type { DashboardSource, DashboardWidget, Visualization } from '@workspace/api-client-react';
import { TITLE_MAX, VIZ_LABEL, initialParamText, paramError, paramsFromText } from './dashboard-model';
import { Modal } from './dialogs';

const VIZ_ICON: Record<Visualization, typeof Hash> = { kpi: Hash, table: Table2, bar: BarChart3, line: LineChart, pie: PieChart };

export type WidgetChoice = { source: string; viz: Visualization; title: string | null; params: Record<string, unknown> };

function SourceStep({ sources, onPick }: { sources: DashboardSource[]; onPick: (s: DashboardSource) => void }) {
  const [q, setQ] = useState('');
  const shown = sources.filter((s) => `${s.title} ${s.description} ${s.area}`.toLowerCase().includes(q.trim().toLowerCase()));
  return <>
    <div className="search-field" style={{ width: '100%' }}><Search size={14} /><input className="field" placeholder="Search data sources" value={q} onChange={(e) => setQ(e.target.value)} autoFocus data-testid="input-search-sources" /></div>
    <div className="dw-source-list">
      {shown.length ? shown.map((s) => <button type="button" key={s.id} className="dw-source" onClick={() => onPick(s)} data-testid={`button-source-${s.id}`}>
        <em>{s.area.replaceAll('_', ' ')}</em><strong>{s.title}</strong><span>{s.description}</span>
      </button>) : <div className="blank-state" style={{ padding: 28 }}><p className="blank-title">No matching sources</p><p style={{ fontSize: 12, margin: 0 }}>Only data from areas you can read is offered.</p></div>}
    </div>
  </>;
}

function ConfigStep({ source, initial, onBack, onCancel, onSubmit, submitLabel }: {
  source: DashboardSource; initial?: DashboardWidget; onBack?: () => void; onCancel: () => void; onSubmit: (c: WidgetChoice) => void; submitLabel: string;
}) {
  const [viz, setViz] = useState<Visualization>(initial && source.visualizations.includes(initial.viz) ? initial.viz : source.defaultVisualization);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [text, setText] = useState(() => initialParamText(source, initial?.params));
  const errors = useMemo(() => Object.fromEntries(source.params.map((p) => [p.name, paramError(p, text[p.name] ?? '')])), [source, text]);
  const invalid = Object.values(errors).some(Boolean);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    onSubmit({ source: source.id, viz, title: title.trim() ? title.trim().slice(0, TITLE_MAX) : null, params: paramsFromText(source, text) });
  };
  return <form onSubmit={submit}>
    <div style={{ marginBottom: 16 }}><div className="eyebrow" style={{ marginBottom: 4 }}>{source.area.replaceAll('_', ' ')}</div><strong style={{ fontSize: 14, color: '#22343b' }}>{source.title}</strong><p style={{ fontSize: 12, color: '#6c7977', margin: '4px 0 0' }}>{source.description}</p></div>
    <div className="form-grid">
      <div className="form-field full"><label>Show as</label><div className="dw-viz-choices" role="radiogroup">{source.visualizations.map((v) => { const Icon = VIZ_ICON[v]; return <button type="button" role="radio" aria-checked={viz === v} key={v} className={`dw-viz ${viz === v ? 'on' : ''}`} onClick={() => setViz(v)} data-testid={`button-viz-${v}`}><Icon size={14} />{VIZ_LABEL[v]}</button>; })}</div></div>
      <div className="form-field full"><label htmlFor="widget-title">Title <span className="optional-label">optional</span></label><input id="widget-title" className="field" maxLength={TITLE_MAX} placeholder={source.title} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-widget-title" /></div>
      {source.params.map((p) => <div className="form-field" key={p.name}>
        <label htmlFor={`param-${p.name}`}>{p.label}</label>
        {p.type === 'enum' ? <select id={`param-${p.name}`} className="select" value={text[p.name] ?? ''} onChange={(e) => setText({ ...text, [p.name]: e.target.value })} data-testid={`select-param-${p.name}`}>
          {!(p.options ?? []).some((o) => o.value === text[p.name]) && <option value={text[p.name] ?? ''} disabled>Choose…</option>}
          {(p.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          : <input id={`param-${p.name}`} className="field" type="number" step={1} min={p.min} max={p.max} value={text[p.name] ?? ''} onChange={(e) => setText({ ...text, [p.name]: e.target.value })} data-testid={`input-param-${p.name}`} />}
        {errors[p.name] ? <div className="dw-field-error">{errors[p.name]}</div> : p.type === 'integer' && (p.min != null || p.max != null) ? <div className="dw-hint">{p.min != null && p.max != null ? `${p.min} to ${p.max}` : p.min != null ? `${p.min} or more` : `${p.max} or less`}</div> : null}
      </div>)}
    </div>
    <div className="modal-actions">
      {onBack && <button type="button" className="btn btn-quiet" onClick={onBack} style={{ marginRight: 'auto' }}><ArrowLeft size={14} />Sources</button>}
      <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>
      <button type="submit" className="btn btn-primary" disabled={invalid} data-testid="button-submit-widget">{submitLabel}</button>
    </div>
  </form>;
}

export function WidgetPicker({ sources, sourcesLoading, sourcesError, initial, onClose, onSubmit }: {
  sources: DashboardSource[] | undefined; sourcesLoading: boolean; sourcesError: string | null; initial?: DashboardWidget; onClose: () => void; onSubmit: (c: WidgetChoice) => void;
}) {
  const [picked, setPicked] = useState<DashboardSource | null>(() => (initial ? sources?.find((s) => s.id === initial.source) ?? null : null));
  const title = initial ? 'Edit widget' : picked ? 'Set up widget' : 'Add widget';
  let content;
  if (sourcesError) content = <div className="feedback error" style={{ margin: 0 }}>{sourcesError}</div>;
  else if (sourcesLoading || !sources) content = <div className="dw-skel"><span /><span /><span /></div>;
  else if (initial && !picked) content = <><div className="feedback error" style={{ margin: 0 }}>This widget uses a data source you cannot access, so its options cannot be changed. You can remove it from the layout.</div><div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={onClose}>Close</button></div></>;
  else if (!picked) content = sources.length ? <SourceStep sources={sources} onPick={setPicked} /> : <div className="blank-state"><p className="blank-title">No data sources available</p><p style={{ fontSize: 12, margin: 0 }}>Your access does not include any dashboard data yet.</p></div>;
  else content = <ConfigStep source={picked} initial={initial} onBack={initial ? undefined : () => setPicked(null)} onCancel={onClose} onSubmit={onSubmit} submitLabel={initial ? 'Apply changes' : 'Add to dashboard'} />;
  return <Modal title={title} eyebrow="Widget" onClose={onClose} wide>{content}</Modal>;
}
