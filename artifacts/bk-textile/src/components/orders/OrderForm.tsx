import { type FormEvent, useState } from 'react';
import { Lock } from 'lucide-react';
import { getGetBuyersQueryKey, useGetBuyers } from '@workspace/api-client-react';
import type { Order, OrderInput, OrderUpdate, Priority } from '@workspace/api-client-react';
import { invoiceDisplay } from './helpers';

export type OrderFormResult = { kind: 'create'; data: OrderInput } | { kind: 'update'; data: OrderUpdate };

const d = (v?: string | null) => (v ? v.slice(0, 10) : '');

export function OrderForm({ onSubmit, busy, initial, onCancel, error }: { onSubmit: (r: OrderFormResult) => void; busy: boolean; initial?: Order; onCancel?: () => void; error?: string | null }) {
  const editing = !!initial;
  const buyers = useGetBuyers({ query: { enabled: !editing, queryKey: getGetBuyersQueryKey() } });
  const [form, setForm] = useState({
    buyerId: initial?.buyerId ?? '', agencyName: initial?.agencyName ?? '', previousOrderReference: initial?.previousOrderReference ?? '',
    orderValue: initial?.orderValue?.toString() ?? '', currencyCode: initial?.currencyCode ?? '', poNumber: initial?.poNumber ?? '',
    style: initial?.style ?? '', description: initial?.description ?? '', quantity: initial?.quantity?.toString() ?? '',
    deliveryDate: d(initial?.deliveryDate), priority: (initial?.priority ?? 'normal') as Priority,
    poIssueDate: d(initial?.poIssueDate), endCustomer: initial?.endCustomer ?? '', priceTerms: initial?.priceTerms ?? '',
    paymentTerms: initial?.paymentTerms ?? '', shipVia: initial?.shipVia ?? '', countryOfOrigin: initial?.countryOfOrigin ?? '',
    overShipTolerancePct: initial?.overShipTolerancePct != null ? String(initial.overShipTolerancePct) : '',
  });
  const set = (key: keyof typeof form, value: string) => setForm((p) => ({ ...p, [key]: value }));
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    const t = (v: string) => v.trim();
    const currency = t(form.currencyCode).toUpperCase();
    const tol = t(form.overShipTolerancePct);
    if (!editing) {
      const buyer = (buyers.data ?? []).find((b) => b.id === form.buyerId);
      if (!buyer) { setLocalError('Choose a buyer from the list.'); return; }
      const data: OrderInput = {
        buyer: buyer.name, buyerId: buyer.id, poNumber: t(form.poNumber), style: t(form.style),
        quantity: Number(form.quantity), deliveryDate: form.deliveryDate, priority: form.priority,
      };
      const opt = { agencyName: form.agencyName, previousOrderReference: form.previousOrderReference, description: form.description, endCustomer: form.endCustomer, priceTerms: form.priceTerms, paymentTerms: form.paymentTerms, shipVia: form.shipVia, countryOfOrigin: form.countryOfOrigin, poIssueDate: form.poIssueDate };
      for (const [k, v] of Object.entries(opt)) if (t(v)) (data as unknown as Record<string, unknown>)[k] = t(v);
      if (t(form.orderValue)) data.orderValue = Number(form.orderValue);
      if (currency) data.currencyCode = currency;
      if (tol) data.overShipTolerancePct = Number(tol);
      onSubmit({ kind: 'create', data });
      return;
    }
    const n = (v: string) => (t(v) ? t(v) : null);
    const data: OrderUpdate = {
      agencyName: n(form.agencyName), previousOrderReference: n(form.previousOrderReference), poNumber: n(form.poNumber),
      style: t(form.style), description: n(form.description), quantity: Number(form.quantity), deliveryDate: form.deliveryDate,
      priority: form.priority, orderValue: t(form.orderValue) ? Number(form.orderValue) : null, currencyCode: currency || null,
      poIssueDate: n(form.poIssueDate), endCustomer: n(form.endCustomer), priceTerms: n(form.priceTerms), paymentTerms: n(form.paymentTerms),
      shipVia: n(form.shipVia), countryOfOrigin: n(form.countryOfOrigin), overShipTolerancePct: tol ? Number(tol) : null,
    };
    onSubmit({ kind: 'update', data });
  };

  const shownError = localError ?? error;
  const field = (id: keyof typeof form, label: string, opts: { required?: boolean; type?: string; optional?: boolean; full?: boolean; min?: string; max?: string; step?: string } = {}) => (
    <div className={`form-field${opts.full ? ' full' : ''}`}>
      <label htmlFor={`order-${id}`}>{label}{opts.required && ' *'}{opts.optional && <span className="optional-label">Optional</span>}</label>
      <input id={`order-${id}`} className="field" type={opts.type ?? 'text'} required={opts.required} min={opts.min} max={opts.max} step={opts.step} value={form[id]} onChange={(e) => set(id, e.target.value)} data-testid={`input-order-${id}`} />
    </div>
  );

  return <form onSubmit={submit} noValidate={false}>
    {shownError && <div role="alert" className="feedback error" data-testid="text-order-form-error">{shownError}</div>}
    <div className="form-section-label">Buyer & PO</div>
    <div className="form-grid">
      <div className="form-field">
        <label htmlFor="order-buyer">Buyer {editing ? <span className="optional-label"><Lock size={9} /> Locked</span> : '*'}</label>
        {editing ? <input id="order-buyer" className="field locked" value={initial.buyer} disabled readOnly />
          : buyers.isError ? <div className="inline-error">Buyers could not be loaded. <button type="button" className="link-btn" onClick={() => buyers.refetch()}>Retry</button></div>
          : <select id="order-buyer" className="select" required value={form.buyerId} disabled={buyers.isLoading} onChange={(e) => set('buyerId', e.target.value)} data-testid="select-order-buyer">
            <option value="">{buyers.isLoading ? 'Loading buyers…' : 'Choose buyer'}</option>
            {(buyers.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.abbreviation})</option>)}
          </select>}
      </div>
      {field('poNumber', 'Buyer PO', { required: true })}
      {editing && <div className="form-field"><label htmlFor="order-invoice">BK invoice <span className="optional-label"><Lock size={9} /> Locked</span></label><input id="order-invoice" className="field locked mono" value={invoiceDisplay(initial).value} disabled readOnly /></div>}
      {field('poIssueDate', 'PO issue date', { type: 'date', optional: true })}
      {field('endCustomer', 'End customer', { optional: true })}
      {field('agencyName', 'Agency', { optional: true })}
      {field('previousOrderReference', 'Previous order reference', { optional: true })}
    </div>
    <div className="form-section-label">Product & delivery</div>
    <div className="form-grid">
      {field('style', 'Style', { required: true })}
      {field('quantity', 'Quantity', { required: true, type: 'number', min: '1', step: '1' })}
      {field('deliveryDate', 'Ship date', { required: true, type: 'date' })}
      <div className="form-field"><label htmlFor="order-priority">Priority</label><select id="order-priority" className="select" value={form.priority} onChange={(e) => set('priority', e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
    </div>
    <div className="form-section-label">Commercial terms</div>
    <div className="form-grid">
      <div className="form-field"><label htmlFor="order-orderValue">Order value <span className="optional-label">Optional · pair with currency</span></label><div className="currency-input"><input id="order-orderValue" className="field" type="number" min="0" step="0.01" required={!!form.currencyCode.trim()} value={form.orderValue} onChange={(e) => set('orderValue', e.target.value)} placeholder="0.00" /><input aria-label="3-letter currency code" className="field currency-code" maxLength={3} minLength={3} pattern="[A-Za-z]{3}" required={!!form.orderValue.trim()} value={form.currencyCode} onChange={(e) => set('currencyCode', e.target.value.toUpperCase())} placeholder="USD" /></div></div>
      {field('priceTerms', 'Price terms', { optional: true })}
      {field('paymentTerms', 'Payment terms', { optional: true })}
      {field('shipVia', 'Ship via', { optional: true })}
      {field('countryOfOrigin', 'Country of origin', { optional: true })}
      {field('overShipTolerancePct', 'Over-shipment tolerance %', { type: 'number', min: '0', max: '100', step: 'any', optional: true })}
      <div className="form-field full"><label htmlFor="order-description">Order notes <span className="optional-label">Optional</span></label><textarea id="order-description" className="textarea" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
    </div>
    <div className="modal-actions">{onCancel && <button type="button" className="btn btn-quiet" onClick={onCancel}>Cancel</button>}<button className="btn btn-primary" disabled={busy || (!editing && buyers.isLoading)} type="submit" data-testid="button-save-order">{busy ? 'Saving…' : editing ? 'Save order changes' : 'Create order'}</button></div>
  </form>;
}
