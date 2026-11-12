import { AlertTriangle } from 'lucide-react';
import { getGetOrderBreakdownQueryKey, useGetOrderBreakdown } from '@workspace/api-client-react';
import type { Colourway } from '@workspace/api-client-react';
import { QueryError, SkeletonRows } from './ui';
import { moneyText } from './helpers';

const fmt = (n: number) => n.toLocaleString();

function Grid({ sizeLabels, colourways, caption, total }: { sizeLabels: string[]; colourways: Colourway[]; caption: string; total: number }) {
  const colTotal = (label: string) => {
    const cells = colourways.map((c) => c.sizes.find((s) => s.sizeLabel === label)).filter(Boolean);
    return cells.length ? fmt(cells.reduce((a, s) => a + (s?.quantity ?? 0), 0)) : '—';
  };
  if (!colourways.length) return <p className="support-note" style={{ padding: '0 18px 14px' }}>No colourways under this line yet.</p>;
  return <div className="table-scroll"><table className="data-table size-grid"><caption className="sr-only">{caption}</caption>
    <thead><tr><th scope="col">Colour</th>{sizeLabels.map((l) => <th key={l} scope="col" className="num">{l}</th>)}<th scope="col" className="num">Total</th></tr></thead>
    <tbody>{colourways.map((c) => <tr key={c.id}><th scope="row"><span className="mono colour-code">{c.code}</span> {c.name}{c.buyerReference && <span className="muted-copy"> · {c.buyerReference}</span>}</th>
      {sizeLabels.map((l) => { const s = c.sizes.find((x) => x.sizeLabel === l); return <td key={l} className={`num mono${s ? '' : ' absent'}`} title={s ? undefined : 'Not on the PO'}>{s ? fmt(s.quantity) : '—'}</td>; })}
      <td className="num mono strong">{fmt(c.total)}</td></tr>)}</tbody>
    <tfoot><tr><th scope="row">Total</th>{sizeLabels.map((l) => <td key={l} className="num mono">{colTotal(l)}</td>)}<td className="num mono strong">{fmt(total)}</td></tr></tfoot>
  </table></div>;
}

export function BreakdownSection({ orderId }: { orderId: string }) {
  const q = useGetOrderBreakdown(orderId, { query: { queryKey: getGetOrderBreakdownQueryKey(orderId), enabled: !!orderId } });
  const b = q.data;
  return <section className="panel" aria-label="Order breakdown" data-testid="section-breakdown">
    <div className="panel-head"><div><p className="panel-kicker">Colour × size</p><h2 className="panel-title">Breakdown</h2></div>
      {b && <div className="grand-total"><span className="detail-label">Grid total</span><strong className="mono" data-testid="text-grid-total">{fmt(b.gridTotal)}</strong><span className="detail-label">of order qty {fmt(b.orderQuantity)}</span></div>}</div>
    {q.isError ? <QueryError title="Breakdown could not be loaded" onRetry={() => q.refetch()} /> : q.isLoading ? <SkeletonRows count={3} /> : b && <>
      {b.quantityMismatch && <div className="mismatch" role="alert" data-testid="alert-quantity-mismatch"><AlertTriangle size={16} /><span>Size grid totals <strong className="mono">{fmt(b.gridTotal)}</strong> pcs but the order quantity is <strong className="mono">{fmt(b.orderQuantity)}</strong> pcs ({b.gridTotal > b.orderQuantity ? '+' : ''}{fmt(b.gridTotal - b.orderQuantity)}). Check the PO before cutting.</span></div>}
      {!b.lines.length && !b.unassignedColourways.length ? <p className="not-provided">Not provided yet</p> : <>
        {b.lines.map((line) => <div className="line-block" key={line.id} data-testid={`line-${line.id}`}>
          <div className="line-head">
            <div><span className="detail-label">Style</span><strong className="mono">{line.styleNumber}</strong></div>
            <div className="line-finish"><span className="detail-label">Finish</span><span>{line.description || '—'}</span></div>
            <div><span className="detail-label">Unit price</span><span className="mono">{moneyText(line.unitPrice, b.currencyCode) ?? '—'}</span></div>
            <div><span className="detail-label">PO line qty</span><span className="mono">{fmt(line.quantity)}</span></div>
            <div><span className="detail-label">Line total</span><strong className={`mono${line.gridTotal !== line.quantity ? ' warn-text' : ''}`}>{fmt(line.gridTotal)}</strong></div>
          </div>
          <Grid sizeLabels={b.sizeLabels} colourways={line.colourways} caption={`Sizes for style ${line.styleNumber}`} total={line.gridTotal} />
        </div>)}
        {b.unassignedColourways.length > 0 && <div className="line-block unassigned" data-testid="block-unassigned">
          <div className="line-head"><div><span className="detail-label">Unassigned colourways</span><strong>Not yet placed under a PO line</strong></div></div>
          <Grid sizeLabels={b.sizeLabels} colourways={b.unassignedColourways} caption="Unassigned colourways" total={b.unassignedColourways.reduce((a, c) => a + c.total, 0)} />
        </div>}
        <div className="grand-row"><span>Grand total (all lines and colours)</span><strong className="mono">{fmt(b.gridTotal)}</strong></div>
        <p className="support-note" style={{ padding: '0 18px 14px' }}>— means the size is not on the PO for that colour. 0 means it is on the PO with zero pieces.</p>
      </>}
    </>}
  </section>;
}
