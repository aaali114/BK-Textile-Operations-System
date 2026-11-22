import type { DocumentData, DocumentSection } from '@workspace/api-client-react';
import { cartonRange, qtyText } from './doc-helpers';

function CuttingSection({ s }: { s: DocumentSection }) {
  return <div className="table-scroll"><table className="paper-table">
    <thead><tr><th>Style</th><th>Colour</th><th>Size</th><th className="num">Actual</th><th className="num">+Allowance</th><th className="num">Total</th></tr></thead>
    <tbody>{s.cuttingRows.map((r, i) => <tr key={i}><td>{r.style}</td><td>{r.colour}</td><td>{r.size}</td><td className="num">{qtyText(r.actual)}</td><td className="num">{qtyText(r.plus)}</td><td className="num">{qtyText(r.total)}</td></tr>)}</tbody>
    <tfoot><tr><td colSpan={3}>Total</td><td className="num">{qtyText(s.totals.actual)}</td><td className="num">{qtyText(s.totals.plus)}</td><td className="num">{qtyText(s.totals.total)}</td></tr></tfoot>
  </table></div>;
}

function PackingSection({ s }: { s: DocumentSection }) {
  return <>
    <div className="paper-totals"><span>Total pcs <strong className="mono">{qtyText(s.totals.total)}</strong></span><span>Dozens <strong className="mono">{s.totals.dozens.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></span><span>Cartons <strong className="mono">{qtyText(s.totals.cartons)}</strong></span></div>
    <div className="table-scroll"><table className="paper-table">
      <thead><tr><th>Carton #</th><th>PO</th><th>Style</th><th>Colour</th><th>Size</th><th className="num">Actual qty</th><th className="num">Cartons</th><th className="num">Qty / carton</th><th className="num">Total pcs</th></tr></thead>
      <tbody>{s.packingRows.map((r, i) => <tr key={i}><td className="mono">{cartonRange(r.cartonFrom, r.cartonTo)}</td><td>{r.po}</td><td>{r.style}</td><td>{r.colour}</td><td>{r.size}</td><td className="num">{qtyText(r.actualQty)}</td><td className="num">{qtyText(r.cartons)}</td><td className="num">{qtyText(r.perCarton)}</td><td className="num">{qtyText(r.totalPcs)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={6}>Total</td><td className="num">{qtyText(s.totals.cartons)}</td><td /><td className="num">{qtyText(s.totals.total)}</td></tr></tfoot>
    </table></div>
  </>;
}

export function DocumentPaper({ data, title, watermark }: { data: DocumentData; title: string; watermark: boolean }) {
  const cutting = data.type === 'cutting_program';
  return <article className={`paper${watermark ? ' draft' : ''}`} aria-label={`${title} preview`} data-testid="document-paper">
    <header className="paper-letterhead">
      <div className="paper-company" data-testid="text-company-name">{data.company.name}</div>
      {data.company.taglineLines.map((l, i) => <div key={i} className="paper-tagline">{l}</div>)}
      {data.company.address && <div className="paper-address">{data.company.address}</div>}
    </header>
    <div className="paper-titlebar"><h2>{title}</h2><span className="mono" data-testid="text-doc-number">No. {data.docNumber}</span></div>
    <dl className="paper-meta">
      <div><dt>Buyer</dt><dd>{data.order.buyer}</dd></div>
      <div><dt>PO</dt><dd className="mono">{data.order.poNumber ?? '-'}</dd></div>
      <div><dt>Style</dt><dd>{data.order.style}</dd></div>
      <div><dt>BK invoice</dt><dd className="mono">{data.order.invoiceRef ?? '-'}</dd></div>
      {cutting ? <div><dt>Allowance</dt><dd className="mono">{data.allowancePct}%</dd></div> : <div><dt>Pcs / carton</dt><dd className="mono">{data.pcsPerCarton ?? '-'}</dd></div>}
      {data.previousReference && <div><dt>Previous ref.</dt><dd>{data.previousReference}</dd></div>}
    </dl>
    {data.sections.length === 0 && <p className="paper-empty">No priced lines on this order yet.</p>}
    {data.sections.map((s) => <section className="paper-section" key={s.lineId} data-testid={`section-${s.lineId}`}>
      <div className="paper-section-head"><strong>{s.finish}</strong><span className="mono">{s.styleNumber} · {qtyText(s.lineQty)} pcs</span></div>
      {s.descriptionLines.length > 0 && <div className="paper-desc">{s.descriptionLines.map((l, i) => <div key={i}>{l}</div>)}</div>}
      {cutting && s.quality && <div className="paper-quality">Quality: {s.quality}</div>}
      {cutting ? <CuttingSection s={s} /> : <PackingSection s={s} />}
    </section>)}
    {data.remarks && <div className="paper-remarks"><strong>Remarks</strong><p>{data.remarks}</p></div>}
  </article>;
}
