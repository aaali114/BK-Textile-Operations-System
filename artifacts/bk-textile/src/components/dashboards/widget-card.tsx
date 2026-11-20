import { useEffect, useRef, useState } from 'react';
import { GripVertical, Lock, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useGetDashboardSourceData } from '@workspace/api-client-react';
import type { DashboardData, DashboardSource, DashboardWidget } from '@workspace/api-client-react';
import { apiErrorInfo } from '@/components/orders/helpers';
import { VIZ_LABEL, stableParams, widgetAccess, widgetDataKey } from './dashboard-model';
import { WidgetViz } from './widget-viz';

type LoadState = { status: 'loading' | 'refreshing' | 'ready' | 'error'; data?: DashboardData; error?: string };

/** Mounted once per source+params+access combination (keyed by parent) so stale data can never show. */
function WidgetData({ widget, tick }: { widget: DashboardWidget; tick: number }) {
  const fetcher = useGetDashboardSourceData();
  const mutateRef = useRef(fetcher.mutateAsync);
  mutateRef.current = fetcher.mutateAsync;
  const paramsRef = useRef(widget.params);
  paramsRef.current = widget.params;
  const seq = useRef(0);
  const alive = useRef(true);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [localTick, setLocalTick] = useState(0);
  const sourceId = widget.source;
  const paramsKey = stableParams(widget.params);

  useEffect(() => { alive.current = true; return () => { alive.current = false; seq.current += 1; }; }, []);
  useEffect(() => {
    const id = ++seq.current;
    setState((prev) => ({ status: prev.data ? 'refreshing' : 'loading', data: prev.data }));
    mutateRef.current({ sourceId, data: { params: paramsRef.current ?? {} } })
      .then((data) => { if (alive.current && id === seq.current) setState({ status: 'ready', data }); })
      .catch((error: unknown) => { if (alive.current && id === seq.current) setState({ status: 'error', error: apiErrorInfo(error).message }); });
  }, [sourceId, paramsKey, tick, localTick]);

  const refresh = () => setLocalTick((t) => t + 1);
  const busy = state.status === 'loading' || state.status === 'refreshing';
  let body;
  if (state.status === 'error') {
    body = <div className="dw-state error" data-testid={`error-widget-${widget.id}`}><strong>Could not load</strong><span>{state.error}</span><button type="button" className="btn btn-quiet dw-nodrag" onClick={refresh} data-testid={`button-retry-widget-${widget.id}`}><RefreshCw size={13} />Try again</button></div>;
  } else if (!state.data) {
    body = <div className="dw-skel" aria-label="Loading widget"><span style={{ width: '62%' }} /><span /><span style={{ width: '84%' }} /><span style={{ width: '48%' }} /></div>;
  } else if (!state.data.rows.length) {
    body = <>{state.data.note && <div className="dw-note">{state.data.note}</div>}<div className="dw-state" data-testid={`empty-widget-${widget.id}`}><strong>Nothing to show yet</strong><span>No records match this widget right now.</span></div></>;
  } else {
    body = <>{state.data.note && <div className="dw-note" data-testid={`note-widget-${widget.id}`}>{state.data.note}</div>}<WidgetViz viz={widget.viz} data={state.data} /></>;
  }
  const at = state.data ? new Date(state.data.generatedAt) : null;
  return <>
    {body}
    <div className="dw-foot">
      <span>{busy ? 'Updating' : at && !Number.isNaN(at.getTime()) ? `Updated ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      <button type="button" className="dw-icon dw-nodrag" onClick={refresh} disabled={busy} aria-label="Refresh widget" title="Refresh" data-testid={`button-refresh-widget-${widget.id}`}><RefreshCw size={12} className={busy ? 'dw-spin' : ''} /></button>
    </div>
  </>;
}

export function WidgetCard({ widget, sources, editing, tick, onEdit, onRemove }: {
  widget: DashboardWidget; sources: DashboardSource[] | undefined; editing: boolean; tick: number; onEdit?: () => void; onRemove?: () => void;
}) {
  const source = sources?.find((s) => s.id === widget.source);
  const access = widgetAccess(widget, sources);
  const title = widget.title?.trim() || source?.title || widget.source.replaceAll('_', ' ');
  return <article className={`dw-card ${access !== 'fetch' ? 'denied' : ''}`} data-testid={`card-widget-${widget.id}`}>
    <header className="dw-head">
      {editing && <span className="dw-drag" title="Drag to move" aria-label="Drag to move"><GripVertical size={15} /></span>}
      <div className="dw-titles"><h3 title={title}>{title}</h3><span className="dw-sub">{VIZ_LABEL[widget.viz]}{source ? ` · ${source.area.replaceAll('_', ' ')}` : ''}</span></div>
      {editing && <>
        <button type="button" className="dw-icon dw-nodrag" onClick={onEdit} aria-label={`Edit ${title}`} title="Edit widget" data-testid={`button-edit-widget-${widget.id}`}><Pencil size={13} /></button>
        <button type="button" className="dw-icon danger dw-nodrag" onClick={onRemove} aria-label={`Remove ${title}`} title="Remove widget" data-testid={`button-remove-widget-${widget.id}`}><Trash2 size={13} /></button>
      </>}
    </header>
    <div className="dw-body">
      {access === 'denied' ? <div className="dw-state denied" data-testid={`noaccess-widget-${widget.id}`}><Lock size={16} /><strong>No access</strong><span>Your current access does not include this data. It stays on the layout in case access is restored.</span></div>
        : access === 'unknown-source' ? <div className="dw-state denied" data-testid={`unavailable-widget-${widget.id}`}><Lock size={16} /><strong>Source unavailable</strong><span>This data source is not offered to you. Remove the widget or ask an administrator.</span></div>
          : <WidgetData key={widgetDataKey(widget)} widget={widget} tick={tick} />}
    </div>
  </article>;
}
