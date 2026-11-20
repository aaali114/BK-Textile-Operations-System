import { useMemo, useRef } from 'react';
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import type { Layout, LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import './dashboards.css';
import type { DashboardSource, DashboardWidget } from '@workspace/api-client-react';
import { GRID_COLS, MAX_H } from './dashboard-model';
import { WidgetCard } from './widget-card';

const BREAKPOINTS = { lg: 960, md: 600, sm: 0 };
const COLS = { lg: GRID_COLS, md: 6, sm: 1 };

function breakpointFor(width: number) { return width >= BREAKPOINTS.lg ? 'lg' : width >= BREAKPOINTS.md ? 'md' : 'sm'; }

function narrowLayouts(widgets: DashboardWidget[]) {
  const ordered = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
  let y = 0;
  const sm: LayoutItem[] = ordered.map((w) => { const item = { i: w.id, x: 0, y, w: 1, h: Math.max(w.h, 4), static: true }; y += item.h; return item; });
  const md: LayoutItem[] = ordered.map((w) => {
    const width = w.w >= 7 ? 6 : 3;
    return { i: w.id, x: width === 6 ? 0 : w.x >= 6 ? 3 : 0, y: w.y, w: width, h: w.h, static: true };
  });
  return { md, sm };
}

export function DashboardGrid({ widgets, sources, editing, tick, onLayout, onEditWidget, onRemoveWidget }: {
  widgets: DashboardWidget[]; sources: DashboardSource[] | undefined; editing: boolean; tick: number;
  onLayout?: (layout: Layout) => void; onEditWidget?: (id: string) => void; onRemoveWidget?: (id: string) => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const bp = breakpointFor(width);
  const editable = editing && bp === 'lg';
  const bpRef = useRef(bp);
  bpRef.current = bp;
  const layouts = useMemo(() => {
    const lg: LayoutItem[] = widgets.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h, minW: 1, minH: 2, maxW: GRID_COLS, maxH: MAX_H }));
    return { lg, ...narrowLayouts(widgets) };
  }, [widgets]);
  const commit = (layout: Layout) => { if (editing && bpRef.current === 'lg' && onLayout) onLayout(layout); };
  return <div ref={containerRef} className="dw-grid-wrap" data-testid="grid-dashboard">
    {editing && bp !== 'lg' && <div className="feedback success dw-narrow-note">Drag and resize work on wider screens. Here you can still add, edit or remove widgets.</div>}
    {mounted && width > 0 && <ResponsiveGridLayout
      width={width} breakpoints={BREAKPOINTS} cols={COLS} layouts={layouts} rowHeight={38} margin={[14, 14]} containerPadding={[0, 0]}
      dragConfig={{ enabled: editable, handle: '.dw-drag', cancel: '.dw-nodrag' }}
      resizeConfig={{ enabled: editable, handles: ['se'] }}
      onDragStop={(layout) => commit(layout)} onResizeStop={(layout) => commit(layout)}>
      {widgets.map((w) => <div key={w.id} className={`dw-cell ${editing ? 'editing' : ''}`}>
        <WidgetCard widget={w} sources={sources} editing={editing} tick={tick} onEdit={() => onEditWidget?.(w.id)} onRemove={() => onRemoveWidget?.(w.id)} />
      </div>)}
    </ResponsiveGridLayout>}
  </div>;
}
