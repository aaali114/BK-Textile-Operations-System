import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardData, DashboardDataColumnsItem, Visualization } from '@workspace/api-client-react';
import { formatCell, toNumber } from './dashboard-model';

const PALETTE = ['#2b6670', '#d5a44f', '#5f8f72', '#a9453d', '#6e8499', '#b07a3b', '#3f8a8f', '#8d6e8f'];
const AXIS = { fontSize: 10, fill: '#788582', fontFamily: 'DM Mono, monospace' };

function columnMap(data: DashboardData) { return new Map<string, DashboardDataColumnsItem>(data.columns.map((c) => [c.key, c])); }

function Issue({ text }: { text: string }) {
  return <div className="dw-state"><strong>Cannot draw this view</strong><span>{text}</span></div>;
}

function MissingNote({ count, total }: { count: number; total: number }) {
  if (!count) return null;
  return <div className="dw-foot-note" data-testid="text-widget-missing">{count} of {total} values missing or not numeric, not plotted.</div>;
}

function KpiView({ data }: { data: DashboardData }) {
  const cols = columnMap(data);
  const valueKey = data.valueKeys[0];
  if (!valueKey) return <Issue text="This source does not name a figure to show." />;
  const valueCol = cols.get(valueKey);
  const labelCol = data.labelKey ? cols.get(data.labelKey) : undefined;
  return <div className="dw-kpis">{data.rows.map((row, i) => {
    const raw = row[valueKey];
    const n = toNumber(raw);
    const label = data.labelKey ? formatCell(row[data.labelKey], labelCol?.type ?? 'string', row) : valueCol?.label ?? valueKey;
    return <div className="dw-kpi" key={i} data-testid={`kpi-${i}`}>
      <span className="dw-kpi-label" title={label}>{label}</span>
      <strong className={`dw-kpi-value ${n === null ? 'missing' : ''}`}>{n === null ? (raw == null || raw === '' ? '—' : String(raw)) : formatCell(n, valueCol?.type ?? 'number', row)}</strong>
      {n === null && (raw == null || raw === '') && <span className="dw-kpi-miss">Not reported</span>}
    </div>;
  })}</div>;
}

function TableView({ data }: { data: DashboardData }) {
  return <div className="dw-scroll"><table className="dw-table"><thead><tr>{data.columns.map((c) => <th key={c.key} className={c.type === 'number' || c.type === 'money' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
    <tbody>{data.rows.map((row, i) => <tr key={i}>{data.columns.map((c) => {
      const v = row[c.key];
      const blank = v === null || v === undefined || v === '';
      return <td key={c.key} className={`${c.type === 'number' || c.type === 'money' ? 'num' : ''} ${blank ? 'blank' : ''}`}>{formatCell(v, c.type, row)}</td>;
    })}</tr>)}</tbody></table></div>;
}

function labelFor(data: DashboardData, row: Record<string, unknown>, i: number, cols: Map<string, DashboardDataColumnsItem>) {
  if (!data.labelKey) return `Row ${i + 1}`;
  const v = row[data.labelKey];
  return v == null || v === '' ? `Row ${i + 1}` : formatCell(v, cols.get(data.labelKey)?.type ?? 'string', row);
}

function CartesianView({ data, kind }: { data: DashboardData; kind: 'bar' | 'line' }) {
  const cols = columnMap(data);
  if (!data.labelKey || !data.valueKeys.length) return <Issue text="This source has no label and value columns to chart. Try the table view." />;
  let missing = 0;
  const rows = data.rows.map((row, i) => {
    const point: Record<string, string | number | null> = { __label: labelFor(data, row, i, cols) };
    for (const k of data.valueKeys) { const n = toNumber(row[k]); if (n === null) missing += 1; point[k] = n; }
    return point;
  });
  const total = rows.length * data.valueKeys.length;
  if (missing === total) return <Issue text="None of the values are numeric, so nothing can be plotted." />;
  const fmt = (value: unknown, key: string) => (value === null || value === undefined ? 'missing' : formatCell(value, cols.get(key)?.type ?? 'number'));
  const tooltip = <Tooltip formatter={(value, _name, item) => fmt(value, String(item?.dataKey ?? ''))} contentStyle={{ fontSize: 11, borderRadius: 5, border: '1px solid #d9d4c9', background: '#fbfaf6' }} />;
  const legend = data.valueKeys.length > 1 ? <Legend wrapperStyle={{ fontSize: 10 }} /> : null;
  return <>
    <div className="dw-chart"><ResponsiveContainer width="100%" height="100%">
      {kind === 'bar' ? <BarChart data={rows}><CartesianGrid stroke="#ece8de" vertical={false} /><XAxis dataKey="__label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#ded8ca' }} /><YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />{tooltip}{legend}
        {data.valueKeys.map((k, i) => <Bar key={k} dataKey={k} name={cols.get(k)?.label ?? k} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} maxBarSize={38} />)}</BarChart>
        : <LineChart data={rows}><CartesianGrid stroke="#ece8de" vertical={false} /><XAxis dataKey="__label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#ded8ca' }} /><YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />{tooltip}{legend}
          {data.valueKeys.map((k, i) => <Line key={k} type="monotone" dataKey={k} name={cols.get(k)?.label ?? k} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} />)}</LineChart>}
    </ResponsiveContainer></div>
    <MissingNote count={missing} total={total} />
  </>;
}

function PieView({ data }: { data: DashboardData }) {
  const cols = columnMap(data);
  const key = data.valueKeys[0];
  if (!data.labelKey || !key) return <Issue text="This source has no label and value columns to chart. Try the table view." />;
  const slices: { name: string; value: number }[] = [];
  let excluded = 0;
  data.rows.forEach((row, i) => { const n = toNumber(row[key]); if (n === null || n <= 0) excluded += 1; else slices.push({ name: labelFor(data, row, i, cols), value: n }); });
  if (!slices.length) return <Issue text="No positive numeric values to divide into slices." />;
  return <>
    <div className="dw-chart"><ResponsiveContainer width="100%" height="100%"><PieChart>
      <Pie data={slices} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="80%" paddingAngle={1.5} stroke="#fbfaf6">
        {slices.map((s, i) => <Cell key={s.name + i} fill={PALETTE[i % PALETTE.length]} />)}
      </Pie>
      <Tooltip formatter={(value) => formatCell(value, cols.get(key)?.type ?? 'number')} contentStyle={{ fontSize: 11, borderRadius: 5, border: '1px solid #d9d4c9', background: '#fbfaf6' }} />
      <Legend wrapperStyle={{ fontSize: 10 }} />
    </PieChart></ResponsiveContainer></div>
    {excluded > 0 && <div className="dw-foot-note">{excluded} row{excluded === 1 ? '' : 's'} left out (missing, zero or not numeric).</div>}
  </>;
}

export function WidgetViz({ viz, data }: { viz: Visualization; data: DashboardData }) {
  if (viz === 'kpi') return <KpiView data={data} />;
  if (viz === 'table') return <TableView data={data} />;
  if (viz === 'pie') return <PieView data={data} />;
  return <CartesianView data={data} kind={viz} />;
}
