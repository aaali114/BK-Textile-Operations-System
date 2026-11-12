import { useMemo } from 'react';
import { Mail } from 'lucide-react';
import { getGetOrderBreakdownQueryKey, getGetOrderFabricsQueryKey, getGetOrderTrimsQueryKey, useGetOrderBreakdown, useGetOrderFabrics, useGetOrderTrims } from '@workspace/api-client-react';
import { QueryError, SkeletonRows } from './ui';
import { dateText } from './ui';
import { humanize } from './helpers';

function useColourNames(orderId: string) {
  const q = useGetOrderBreakdown(orderId, { query: { queryKey: getGetOrderBreakdownQueryKey(orderId), enabled: !!orderId } });
  return useMemo(() => {
    const m = new Map<string, string>();
    const b = q.data;
    if (b) for (const c of [...b.lines.flatMap((l) => l.colourways), ...b.unassignedColourways]) m.set(c.id, `${c.code} ${c.name}`);
    return m;
  }, [q.data]);
}
const colourText = (id: string | null, names: Map<string, string>) => (id == null ? 'All colours' : names.get(id) ?? 'Specific colour');
const v = (x: string | number | null | undefined) => (x == null || x === '' ? '—' : x);

function SourceLink({ id, onOpenEmail }: { id: string | null; onOpenEmail: (id: string) => void }) {
  return id ? <button type="button" className="link-btn" onClick={() => onOpenEmail(id)} aria-label="Open source email"><Mail size={12} /> Email</button> : <span className="muted-copy">—</span>;
}

export function FabricsSection({ orderId, onOpenEmail }: { orderId: string; onOpenEmail: (id: string) => void }) {
  const q = useGetOrderFabrics(orderId, { query: { queryKey: getGetOrderFabricsQueryKey(orderId), enabled: !!orderId } });
  const names = useColourNames(orderId);
  return <section className="panel spec-panel" aria-label="Fabrics" data-testid="section-fabrics">
    <div className="panel-head"><div><p className="panel-kicker">Specification</p><h2 className="panel-title">Fabrics</h2></div></div>
    {q.isError ? <QueryError title="Fabrics could not be loaded" onRetry={() => q.refetch()} /> : q.isLoading ? <SkeletonRows count={2} /> : !q.data?.length ? <p className="not-provided">Not provided yet</p> :
      <div className="table-scroll"><table className="data-table spec-table"><thead><tr><th>Placement</th><th>Fabric</th><th>Composition / construction</th><th className="num">GSM</th><th className="num">Width cm</th><th>Colour</th><th>Supplier</th><th className="num">Consumption / pc</th><th>Notes</th><th>Source</th></tr></thead>
        <tbody>{q.data.map((f) => <tr key={f.id}><td><strong>{f.placement}</strong><div className="cell-sub">{colourText(f.colourwayId, names)}</div></td><td>{f.description}</td><td>{v(f.composition)}<div className="cell-sub">{f.construction ?? ''}</div></td><td className="num mono">{v(f.gsm)}</td><td className="num mono">{v(f.widthCm)}</td><td>{v(f.colour)}</td><td>{v(f.supplier)}</td><td className="num mono">{f.consumptionPerPiece != null ? `${f.consumptionPerPiece} ${f.consumptionUnit ?? ''}`.trim() : '—'}</td><td className="notes-cell">{f.notes || '—'}<div className="cell-sub">Updated {dateText(f.updatedAt)}</div></td><td><SourceLink id={f.sourceEmailId} onOpenEmail={onOpenEmail} /></td></tr>)}</tbody></table></div>}
  </section>;
}

export function TrimsSection({ orderId, onOpenEmail }: { orderId: string; onOpenEmail: (id: string) => void }) {
  const q = useGetOrderTrims(orderId, { query: { queryKey: getGetOrderTrimsQueryKey(orderId), enabled: !!orderId } });
  const names = useColourNames(orderId);
  return <section className="panel spec-panel" aria-label="Trims" data-testid="section-trims">
    <div className="panel-head"><div><p className="panel-kicker">Specification</p><h2 className="panel-title">Trims & accessories</h2></div></div>
    {q.isError ? <QueryError title="Trims could not be loaded" onRetry={() => q.refetch()} /> : q.isLoading ? <SkeletonRows count={2} /> : !q.data?.length ? <p className="not-provided">Not provided yet</p> :
      <div className="table-scroll"><table className="data-table spec-table"><thead><tr><th>Type</th><th>Description</th><th>Applies to</th><th>Supplier</th><th className="num">Qty / pc</th><th>Supplied by</th><th>Notes</th><th>Source</th></tr></thead>
        <tbody>{q.data.map((t) => <tr key={t.id}><td><span className="type-tag">{humanize(t.trimType)}</span></td><td>{t.description}</td><td>{colourText(t.colourwayId, names)}<div className="cell-sub">{t.sizeLabel ? `Size ${t.sizeLabel}` : 'All sizes'}</div></td><td>{v(t.supplier)}</td><td className="num mono">{t.quantityPerPiece != null ? `${t.quantityPerPiece} ${t.unit ?? ''}`.trim() : '—'}</td><td>{t.buyerSupplied ? 'Buyer' : 'BK'}</td><td className="notes-cell">{t.notes || '—'}<div className="cell-sub">Updated {dateText(t.updatedAt)}</div></td><td><SourceLink id={t.sourceEmailId} onOpenEmail={onOpenEmail} /></td></tr>)}</tbody></table></div>}
  </section>;
}
