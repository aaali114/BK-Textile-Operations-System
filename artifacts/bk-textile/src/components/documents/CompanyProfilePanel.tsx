import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetCompanyProfileQueryKey, useGetCompanyProfile, useSaveCompanyProfile } from '@workspace/api-client-react';
import type { CompanyProfile } from '@workspace/api-client-react';
import { apiErrorInfo } from '../orders/helpers';
import { QueryError, SkeletonRows } from '../orders/ui';
import './documents.css';

type F = { name: string; lines: string[]; address: string };
const toF = (p: CompanyProfile): F => ({ name: p.name, lines: [0, 1, 2, 3].map((i) => p.taglineLines[i] ?? ''), address: p.address });

export function CompanyProfilePanel() {
  const query = useGetCompanyProfile({ query: { queryKey: getGetCompanyProfileQueryKey() } });
  const save = useSaveCompanyProfile();
  const client = useQueryClient();
  const [form, setForm] = useState<F | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => { if (query.data && !form) setForm(toF(query.data)); }, [query.data, form]);
  const original = query.data ? toF(query.data) : null;
  const dirty = !!form && !!original && JSON.stringify(form) !== JSON.stringify(original);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) { setMsg({ text: 'Company name is required.', error: true }); return; }
    const data: CompanyProfile = { name: form.name.trim(), taglineLines: form.lines.map((l) => l.trim()).filter(Boolean).slice(0, 4), address: form.address.trim() };
    save.mutate({ data }, {
      onSuccess: (saved) => { client.setQueryData(getGetCompanyProfileQueryKey(), saved); setForm(toF(saved)); setMsg({ text: 'Company profile saved. New document previews use it; approved documents keep their original letterhead.' }); },
      onError: (err) => setMsg({ text: apiErrorInfo(err).message, error: true }),
    });
  };
  return <section className="panel company-profile" data-testid="panel-company-profile">
    <div className="panel-head"><div><p className="panel-kicker">Document letterhead</p><h2 className="panel-title">Company profile</h2></div></div>
    {query.isError ? <QueryError detail={apiErrorInfo(query.error).message} onRetry={() => query.refetch()} /> : !form ? <SkeletonRows count={3} /> :
      <form onSubmit={submit} style={{ padding: 20 }}>
        {msg && <div className={`feedback ${msg.error ? 'error' : 'success'}`} role={msg.error ? 'alert' : 'status'}>{msg.text}</div>}
        <fieldset disabled={save.isPending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="form-grid">
            <div className="form-field full"><label htmlFor="cp-name">Company name *</label><input id="cp-name" className="field" maxLength={120} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-company-name" /></div>
            {form.lines.map((l, i) => <div className="form-field" key={i}><label htmlFor={`cp-line-${i}`}>Tagline line {i + 1} <span className="optional-label">Optional</span></label><input id={`cp-line-${i}`} className="field" maxLength={160} value={l} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? e.target.value : x)) })} data-testid={`input-company-tagline-${i}`} /></div>)}
            <div className="form-field full"><label htmlFor="cp-address">Address</label><textarea id="cp-address" className="textarea" rows={2} maxLength={300} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="input-company-address" /></div>
          </div>
          <div className="modal-actions"><button type="button" className="btn btn-quiet" disabled={!dirty} onClick={() => original && setForm(original)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!dirty} data-testid="button-save-company">{save.isPending ? 'Saving…' : 'Save profile'}</button></div>
        </fieldset>
      </form>}
  </section>;
}
