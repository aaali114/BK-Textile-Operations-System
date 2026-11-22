import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Lock, RefreshCw, UserCheck, Users, Wand2, X } from 'lucide-react';
import {
  Department, Permission, getGetAccessTemplatesQueryKey, getGetCurrentUserQueryKey, getListUsersQueryKey,
  useGetAccessTemplates, useListUsers, useUpdateUserAccess,
} from '@workspace/api-client-react';
import type { AccessLevel, AccessTemplate, AreaAccess, CurrentUser, UserAccessUpdate, UserAccount, UserStatus } from '@workspace/api-client-react';
import { Form, FormField } from '@/components/ui/form';
import { useAccess } from '../components/access/AccessProvider';
import { UserRoleActions } from '../components/access/UserRoleActions';
import { CompanyProfilePanel } from '../components/documents/CompanyProfilePanel';
import { DashboardTemplatesPanel } from '../components/dashboards/dashboard-templates';
import { AREA_LABELS, type Area } from '../components/access/policy';
import { apiErrorInfo, dateTimeText, humanize } from '../components/orders/helpers';
import '../components/access/users-access.css';

const AREAS = Object.keys(AREA_LABELS) as Area[];
const LEVELS: AccessLevel[] = ['none', 'read', 'write'];
const DEPARTMENTS = Object.values(Department);
const PERMISSIONS: { key: Permission; label: string; note: string }[] = [
  { key: Permission.invoice_override, label: 'Invoice override', note: 'Change the invoice counter or an order\u2019s BK invoice.' },
  { key: Permission.commercial_edit, label: 'Commercial edit', note: 'Create orders and edit buyer, PO, value, terms, quantity and dates.' },
  { key: Permission.intake_run, label: 'Intake run', note: 'Read the orders mailbox and re-apply emails.' },
  { key: Permission.prepare_documents, label: 'Prepare documents', note: 'Draft, edit and submit cutting programs and packing lists.' },
  { key: Permission.approve_documents, label: 'Approve documents', note: 'Approve or send back documents as administrator, deputy or the order\u2019s responsible merchandiser; never one\u2019s own.' },
];

type AccessForm = { status: UserStatus; department: string; areas: AreaAccess; permissions: Permission[] };
type Flash = { message: string; error?: boolean } | null;

const toForm = (u: UserAccount): AccessForm => ({ status: u.status, department: u.department ?? '', areas: { ...u.areas }, permissions: [...u.permissions] });
const permsEqual = (a: Permission[], b: Permission[]) => a.length === b.length && a.every((p) => b.includes(p));
const areasEqual = (a: AreaAccess, b: AreaAccess) => AREAS.every((k) => a[k] === b[k]);
const initials = (u: UserAccount) => (u.name || u.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
const label = (u: UserAccount) => u.name || u.email || 'Unnamed user';

/** Mirrors the backend safeguards so the UI explains them; the server remains authoritative. */
function lockReason(actor: CurrentUser, target: UserAccount): string | null {
  if (target.id === actor.userId) return 'This is your own account. Nobody can change their own access here, so you cannot lock yourself out. Ask the administrator (or deputy) to make changes for you.';
  if (target.role === 'admin') return "Administrators' access cannot be changed by others; an administrator can only step down themselves.";
  if (target.role === 'deputy' && actor.role !== 'admin') return 'Only the administrator can change the deputy\u2019s access. You can view it here.';
  return null;
}

function Modal({ title, eyebrow, children, onClose, testId }: { title: string; eyebrow: string; children: React.ReactNode; onClose: () => void; testId: string }) {
  return <div className="modal-scrim" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby={`${testId}-title`} data-testid={testId} style={{ width: 'min(520px,100%)' }}>
      <div className="modal-head"><div><div className="eyebrow">{eyebrow}</div><h2 id={`${testId}-title`} className="panel-title" style={{ fontSize: 19 }}>{title}</h2></div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} data-testid={`${testId}-close`}><X size={17} /></button></div>
      <div className="modal-content">{children}</div>
    </section>
  </div>;
}

function UserRow({ u, selected, isSelf, onSelect }: { u: UserAccount; selected: boolean; isSelf: boolean; onSelect: () => void }) {
  return <button type="button" className={`ua-row ${selected ? 'sel' : ''}`} onClick={onSelect} data-testid={`row-user-${u.id}`} aria-pressed={selected}>
    <span className={`ua-avatar ${u.status}`}>{initials(u)}</span>
    <span style={{ minWidth: 0 }}>
      <div className="ua-name" data-testid={`text-user-name-${u.id}`}>{label(u)}{isSelf && <span className="mono" style={{ color: '#b08a3e', fontWeight: 400, fontSize: 10 }}> · you</span>}</div>
      <div className="ua-email" data-testid={`text-user-email-${u.id}`}>{u.email ?? 'No email on record'}</div>
      <div className="ua-weave" aria-label="Area access summary">{AREAS.map((a) => <i key={a} className={u.areas[a]} title={`${AREA_LABELS[a]}: ${u.areas[a]}`} />)}</div>
    </span>
    <span className="ua-meta"><div data-testid={`text-user-department-${u.id}`}>{u.department ? humanize(u.department) : 'Unassigned'}</div><div data-testid={`text-user-last-seen-${u.id}`}>Seen {u.lastSeenAt ? dateTimeText(u.lastSeenAt) : 'never'}</div></span>
    <span className="ua-badges">
      {u.role !== 'user' && <span className={`ua-role ${u.role}`} data-testid={`status-user-role-${u.id}`}>{u.role === 'admin' ? 'Administrator' : 'Deputy'}</span>}
      <span className={`status-pill ${u.status === 'pending' ? 'warn' : u.status === 'disabled' ? 'neutral' : ''}`} data-testid={`status-user-${u.id}`}>{u.status}</span>
    </span>
  </button>;
}

function AccessEditor({ user, users, actor, templates, templatesState, adminLocked, onClose }: {
  user: UserAccount; users: UserAccount[]; actor: CurrentUser; templates: AccessTemplate[] | undefined;
  templatesState: { loading: boolean; error: unknown; retry: () => void }; adminLocked: boolean; onClose: () => void;
}) {
  const client = useQueryClient();
  const update = useUpdateUserAccess();
  const [roleBusy, setRoleBusy] = useState(false);
  const [original, setOriginal] = useState<AccessForm>(() => toForm(user));
  const form = useForm<AccessForm>({ defaultValues: original });
  const values = form.watch();
  const [templateKey, setTemplateKey] = useState('');
  const [flash, setFlash] = useState<Flash>(null);
  const [confirm, setConfirm] = useState<null | 'disable'>(null);
  const lock = lockReason(actor, user);
  const editable = !lock && !adminLocked;

  const dirty = values.status !== original.status || values.department !== original.department || !areasEqual(values.areas, original.areas) || !permsEqual(values.permissions, original.permissions);

  const afterChange = (saved: UserAccount) => {
    client.setQueryData<UserAccount[]>(getListUsersQueryKey(), (old) => old?.map((u) => u.id === saved.id ? saved : u));
    void client.invalidateQueries({ queryKey: getListUsersQueryKey() });
    void client.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
  };

  const doSave = () => {
    if (!editable || update.isPending || roleBusy) return;
    const v = form.getValues();
    const data: UserAccessUpdate = {};
    if (v.status !== original.status) data.status = v.status;
    if (v.department !== original.department) data.department = v.department || null;
    if (!areasEqual(v.areas, original.areas)) data.areas = { ...v.areas };
    if (!permsEqual(v.permissions, original.permissions)) data.permissions = [...v.permissions];
    setFlash(null);
    update.mutate({ userId: user.id, data }, {
      onSuccess: (saved) => {
        afterChange(saved);
        const next = toForm(saved);
        setOriginal(next); form.reset(next); setTemplateKey(''); setConfirm(null);
        setFlash({ message: `Access saved for ${label(saved)}.` });
      },
      onError: (err) => { setConfirm(null); setFlash({ message: apiErrorInfo(err).message, error: true }); },
    });
  };
  const submit = form.handleSubmit(() => {
    if (values.status === 'disabled' && original.status !== 'disabled') setConfirm('disable'); else doSave();
  });
  const cancel = () => { form.reset(original); setTemplateKey(''); setFlash(null); };

  const applyTemplate = () => {
    const t = templates?.find((x) => x.department === templateKey);
    if (!t) return;
    const areas: AreaAccess = { dashboard: 'none', merchandising: 'none', department_work: 'none', materials: 'none', quality: 'none' };
    for (const area of AREAS) areas[area] = t.areas[area] ?? 'none';
    form.setValue('areas', areas, { shouldDirty: true });
    form.setValue('permissions', [...t.permissions], { shouldDirty: true });
    form.setValue('department', t.department, { shouldDirty: true });
    setFlash({ message: `${humanize(t.department)} template applied to the form. Review, then save to make it take effect.` });
  };


  const statusOptions: { value: UserStatus; text: string }[] = original.status === 'pending'
    ? [{ value: 'pending', text: 'Keep pending' }, { value: 'active', text: 'Approve' }, { value: 'disabled', text: 'Disable' }]
    : original.status === 'active' ? [{ value: 'active', text: 'Active' }, { value: 'disabled', text: 'Disable' }]
    : [{ value: 'disabled', text: 'Disabled' }, { value: 'active', text: 'Restore' }];


  return <section className="panel ua-panel" data-testid={`panel-user-editor-${user.id}`}>
    <div className="ua-editor-head">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 12, minWidth: 0 }}>
          <span className={`ua-avatar ${user.status}`} style={{ width: 42, height: 42 }}>{initials(user)}</span>
          <div style={{ minWidth: 0 }}><p className="panel-kicker" style={{ margin: 0 }}>Access record</p>
            <h2 className="panel-title" style={{ fontSize: 18, marginTop: 4 }} data-testid="text-editor-name">{label(user)}</h2>
            <div className="ua-email" data-testid="text-editor-email">{user.email ?? 'No email on record'}</div></div>
        </div>
        <button type="button" className="icon-btn" aria-label="Close access record" onClick={onClose} data-testid="button-close-editor"><X size={16} /></button>
      </div>
    </div>
    <Form {...form}><form onSubmit={submit}><fieldset disabled={!editable || update.isPending || roleBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="ua-editor-body">
        {flash && <div className={`feedback ${flash.error ? 'error' : 'success'}`} style={{ margin: 0 }} role={flash.error ? 'alert' : 'status'} data-testid="text-editor-feedback">{flash.message}</div>}
        <div className="ua-facts">
          <div><span>Role</span><strong data-testid="text-editor-role">{user.role === 'admin' ? 'Administrator' : user.role === 'deputy' ? 'Deputy' : 'Staff user'}</strong></div>
          <div><span>Status</span><strong data-testid="text-editor-status">{humanize(user.status)}</strong></div>
          <div><span>Last seen</span><strong>{user.lastSeenAt ? dateTimeText(user.lastSeenAt) : 'Never'}</strong></div>
          <div><span>Registered</span><strong>{dateTimeText(user.createdAt)}</strong></div>
          {user.approvedAt && <div style={{ gridColumn: '1/-1' }}><span>Approved</span><strong>{dateTimeText(user.approvedAt)}{user.approvedBy ? ` · by ${users.find((x) => x.id === user.approvedBy)?.email ?? user.approvedBy}` : ''}</strong></div>}
        </div>
        {lock && <div className="ua-lock" data-testid="text-access-locked"><Lock size={15} /><span>{lock}</span></div>}

        <div><div className="ua-section-label"><span>Account status</span></div>
          <FormField control={form.control} name="status" render={({ field }) => <div className="ua-status-set" role="radiogroup" aria-label="Account status">
            {statusOptions.map((o) => <button type="button" key={o.value} role="radio" aria-checked={field.value === o.value} disabled={!editable} className={`${field.value === o.value ? 'on' : ''} ${o.value}`} onClick={() => field.onChange(o.value)} data-testid={`button-status-${o.value}`}>{o.text}</button>)}
          </div>} />
        </div>

        {editable && <div className="ua-template">
          <select className="select" aria-label="Department access template" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} disabled={templatesState.loading || !!templatesState.error} data-testid="select-template">
            <option value="">{templatesState.loading ? 'Loading templates' : templatesState.error ? 'Templates unavailable' : 'Department template'}</option>
            {templates?.map((t) => <option key={t.department} value={t.department}>{humanize(t.department)}</option>)}
          </select>
          <button type="button" className="btn btn-quiet" style={{ minHeight: 36 }} disabled={!templateKey} onClick={applyTemplate} data-testid="button-apply-template"><Wand2 size={14} />Apply</button>
          {templatesState.error ? <p>{apiErrorInfo(templatesState.error).message} <button type="button" className="ref-link" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={templatesState.retry} data-testid="button-retry-templates">Retry</button></p>
            : <p>Fills department, areas and permissions on this form only. Areas the template leaves out become None. Nothing is saved until you press Save.</p>}
        </div>}

        <div><div className="ua-section-label"><span>Department</span></div>
          <FormField control={form.control} name="department" render={({ field }) => <select className="select" aria-label="Department" disabled={!editable} value={field.value} onChange={(e) => field.onChange(e.target.value)} data-testid="select-department">
            <option value="">Unassigned</option>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{humanize(d)}</option>)}
            {field.value && !DEPARTMENTS.includes(field.value as Department) && <option value={field.value}>{humanize(field.value)}</option>}
          </select>} />
        </div>

        <div><div className="ua-section-label"><span>Area access</span><span>None · Read · Write</span></div>
          <div className="ua-matrix">{AREAS.map((area) => <FormField key={area} control={form.control} name={`areas.${area}`} render={({ field }) => <div className={`ua-mrow ${field.value !== original.areas[area] ? 'changed' : ''}`}>
            <span>{AREA_LABELS[area]}</span>
            <span className="ua-seg" role="radiogroup" aria-label={`${AREA_LABELS[area]} access`}>{LEVELS.map((lv) => <button type="button" key={lv} role="radio" aria-checked={field.value === lv} disabled={!editable} className={`${field.value === lv ? 'on' : ''} ${lv}`} onClick={() => field.onChange(lv)} data-testid={`button-area-${area}-${lv}`}>{lv === 'none' ? 'None' : lv === 'read' ? 'Read' : 'Write'}</button>)}</span>
          </div>} />)}</div>
        </div>

        <div><div className="ua-section-label"><span>Special permissions</span></div>
          <FormField control={form.control} name="permissions" render={({ field }) => <div className="ua-matrix">{PERMISSIONS.map((p) => <label key={p.key} className="ua-perm" style={{ cursor: editable ? 'pointer' : 'default' }}>
            <input type="checkbox" disabled={!editable} checked={field.value.includes(p.key)} onChange={(e) => field.onChange(e.target.checked ? [...field.value, p.key] : field.value.filter((x) => x !== p.key))} data-testid={`checkbox-permission-${p.key}`} />
            <span><strong style={{ fontWeight: 700 }}>{p.label}</strong> <span className="mono" style={{ fontSize: 9, color: '#9aa39e' }}>{p.key}</span><small>{p.note}</small></span>
          </label>)}</div>} />
        </div>

      </div>
      {editable && <div className="ua-footer">
        <span className="ua-dirty" data-testid="text-unsaved">{dirty ? 'Unsaved changes' : <span style={{ color: '#82908a' }}>No changes</span>}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-quiet" disabled={!dirty || update.isPending} onClick={cancel} data-testid="button-cancel-access">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!dirty || update.isPending} data-testid="button-save-access">{update.isPending ? 'Saving' : <><Check size={14} />Save access</>}</button>
        </span>
      </div>}
    </fieldset></form></Form>
    <UserRoleActions actor={actor} user={user} users={users} disabled={dirty || update.isPending || adminLocked} onChanged={afterChange} onBusyChange={setRoleBusy} />

    {confirm === 'disable' && <Modal testId="dialog-confirm-disable" eyebrow="Confirm access removal" title={`Disable ${label(user)}?`} onClose={() => setConfirm(null)}>
      <p style={{ fontSize: 13, color: '#4d5f5f', lineHeight: 1.6, margin: 0 }}>{user.email || user.id} will lose access to the operations system at their next request. Their record stays, and you can restore access later.</p>
      <div className="modal-actions"><button type="button" className="btn btn-quiet" onClick={() => setConfirm(null)} data-testid="button-cancel-disable">Keep access</button><button type="button" className="btn btn-danger" disabled={update.isPending} onClick={doSave} data-testid="button-confirm-disable">{update.isPending ? 'Saving' : 'Disable and save'}</button></div>
    </Modal>}
  </section>;
}

function UsersWorkspace({ actor }: { actor: CurrentUser }) {
  const list = useListUsers({ query: { queryKey: getListUsersQueryKey(), refetchInterval: 30_000 } });
  const templates = useGetAccessTemplates({ query: { queryKey: getGetAccessTemplatesQueryKey() } });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | UserStatus>('all');
  const [adminLocked, setAdminLocked] = useState(false);
  useEffect(() => {
    const start = () => setAdminLocked(true); const end = () => setAdminLocked(false);
    window.addEventListener('bk:admin-transfer-start', start); window.addEventListener('bk:admin-transfer-end', end);
    return () => { window.removeEventListener('bk:admin-transfer-start', start); window.removeEventListener('bk:admin-transfer-end', end); };
  }, []);
  const users = list.data;
  const groups = useMemo(() => {
    const all = (users ?? []).filter((u) => filter === 'all' || u.status === filter);
    const by = (s: UserStatus) => all.filter((u) => u.status === s).sort((a, b) => label(a).localeCompare(label(b)));
    return [{ key: 'pending', title: 'Waiting for approval', items: by('pending') }, { key: 'active', title: 'Active staff', items: by('active') }, { key: 'disabled', title: 'Access removed', items: by('disabled') }];
  }, [users, filter]);
  const counts = useMemo(() => ({ pending: users?.filter((u) => u.status === 'pending').length ?? 0, active: users?.filter((u) => u.status === 'active').length ?? 0, disabled: users?.filter((u) => u.status === 'disabled').length ?? 0, administrators: users?.filter((u) => u.role === 'admin') ?? [], deputies: users?.filter((u) => u.role === 'deputy') ?? [] }), [users]);
  const selected = users?.find((u) => u.id === selectedId);

  return <>
    <div className="ua-summary">
      <div className="ua-sum pending"><span className="metric-label">Waiting approval</span><strong className="mono" data-testid="text-count-pending">{list.isLoading ? '--' : counts.pending}</strong></div>
      <div className="ua-sum"><span className="metric-label">Active staff</span><strong className="mono" data-testid="text-count-active">{list.isLoading ? '--' : counts.active}</strong></div>
      <div className="ua-sum"><span className="metric-label">Access removed</span><strong className="mono" data-testid="text-count-disabled">{list.isLoading ? '--' : counts.disabled}</strong></div>
      <div className="ua-sum"><span className="metric-label">Leadership seats</span><strong style={{ fontSize: 14, marginTop: 12 }} data-testid="text-role-counts">{list.isLoading ? '--' : `${counts.administrators.length}/2 administrators · ${counts.deputies.length}/2 deputies`}</strong><p style={{ fontSize: 11, marginBottom: 0 }}>{[...counts.administrators, ...counts.deputies].map(label).join(', ') || 'Not appointed'}</p></div>
    </div>
    <div className="ua-grid">
      <section className="panel" style={{ overflow: 'hidden' }}>
        <div className="panel-head"><div><p className="panel-kicker">Staff register</p><h2 className="panel-title">People with sign-ins {users && <span className="mono" style={{ fontSize: 11, color: '#82908a', fontWeight: 400 }}>· {users.length}</span>}</h2></div>
          <div className="ua-tools"><div className="ua-filter" role="tablist" aria-label="Filter by status">{(['all', 'pending', 'active', 'disabled'] as const).map((f) => <button type="button" key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)} data-testid={`button-filter-${f}`}>{f}</button>)}</div>
            <button type="button" className="icon-btn" aria-label="Refresh users" onClick={() => list.refetch()} data-testid="button-refresh-users"><RefreshCw size={14} className={list.isFetching ? 'animate-spin' : ''} /></button></div></div>
        {list.isError ? <div className="blank-state" data-testid="state-users-error"><div className="blank-icon"><AlertTriangle size={18} /></div><p className="blank-title">The staff register could not be loaded</p><p style={{ fontSize: 12 }}>{apiErrorInfo(list.error).message}</p><button type="button" className="btn btn-primary" onClick={() => list.refetch()} data-testid="button-retry-users">Try again</button></div>
          : list.isLoading ? <div data-testid="state-users-loading">{Array.from({ length: 6 }, (_, i) => <div key={i} className="ua-skel" style={{ animationDelay: `${i * 0.08}s` }} />)}</div>
          : !users?.length ? <div className="blank-state" data-testid="state-users-empty"><div className="blank-icon"><Users size={18} /></div><p className="blank-title">No one has signed in yet</p><p style={{ fontSize: 12 }}>Staff appear here after their first sign-in, waiting for approval.</p></div>
          : groups.every((g) => !g.items.length) ? <div className="blank-state" data-testid="state-users-filter-empty"><p className="blank-title">No {filter} users</p><button type="button" className="btn btn-quiet" onClick={() => setFilter('all')}>Show everyone</button></div>
          : groups.filter((g) => g.items.length).map((g) => <div key={g.key}>
            <div className={`ua-group ${g.key === 'pending' ? 'pending' : ''}`}><span>{g.title}</span><span>{g.items.length}</span></div>
            {g.items.map((u) => <UserRow key={u.id} u={u} isSelf={u.id === actor.userId} selected={u.id === selectedId} onSelect={() => setSelectedId(u.id)} />)}
          </div>)}
      </section>
      {selected ? <AccessEditor key={selected.id} user={selected} users={users ?? []} actor={actor} templates={templates.data} adminLocked={adminLocked}
        templatesState={{ loading: templates.isLoading, error: templates.isError ? templates.error : null, retry: () => void templates.refetch() }} onClose={() => setSelectedId(null)} />
        : <section className="panel ua-panel"><div className="ua-empty-panel" data-testid="state-editor-empty"><div className="loom" /><p className="blank-title">Select a person to set their access</p>
          {counts.pending > 0 ? <><p style={{ margin: '0 0 12px' }}>{counts.pending} {counts.pending === 1 ? 'person is' : 'people are'} waiting for approval.</p><button type="button" className="btn btn-primary" onClick={() => { setFilter('all'); setSelectedId(users?.find((person) => person.status === 'pending')?.id ?? null); }} data-testid="button-review-pending"><UserCheck size={14} />Review first request</button></>
            : <p style={{ margin: 0 }}>Approve, disable or restore accounts, assign a department and choose None, Read or Write for each area.</p>}</div></section>}
    </div>
  </>;
}

export default function UsersAccessPage() {
  const { user, canManageUsers } = useAccess();
  return <main className="page-wrap" data-testid="page-users-access">
    <div className="page-title-row"><div><div className="eyebrow">Administration · Access control</div><h1 className="page-title">Users &amp; access</h1>
      <p className="page-subtitle">Approve new sign-ins and decide, area by area, who can see and change orders, floor work, lots and inspections.</p></div></div>
    {user && canManageUsers ? <><UsersWorkspace actor={user} /><CompanyProfilePanel /><DashboardTemplatesPanel /></>
      : <section className="panel"><div className="blank-state" data-testid="state-users-forbidden"><div className="blank-icon"><Lock size={18} /></div><p className="blank-title">Only the administrator or deputy can manage users</p><p style={{ fontSize: 12 }}>Ask them if your access needs to change.</p></div></section>}
  </main>;
}
