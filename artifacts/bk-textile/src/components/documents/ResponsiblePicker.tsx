import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetOrderQueryKey, getListDocumentsAwaitingApprovalQueryKey, getListOrderDocumentsQueryKey, getListUsersQueryKey,
  useListUsers, useSetOrderResponsible,
} from '@workspace/api-client-react';
import type { Order } from '@workspace/api-client-react';
import { useAccess } from '../access/AccessProvider';
import { apiErrorInfo, refreshOrderCore } from '../orders/helpers';

export function ResponsiblePicker({ order }: { order: Order }) {
  const access = useAccess();
  const manage = access.canManageUsers;
  const users = useListUsers({ query: { queryKey: getListUsersQueryKey(), enabled: manage } });
  const set = useSetOrderResponsible();
  const client = useQueryClient();
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const current = order.responsibleUserId ?? '';
  const active = (users.data ?? []).filter((u) => u.status === 'active');
  const name = (id: string) => { const u = users.data?.find((x) => x.id === id); return u ? (u.name || u.email || id) : null; };
  const change = (value: string) => {
    setMsg(null);
    set.mutate({ orderId: order.id, data: { userId: value || null } }, {
      onSuccess: () => {
        refreshOrderCore(client, order.id);
        void client.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) });
        void client.invalidateQueries({ queryKey: getListOrderDocumentsQueryKey(order.id) });
        void client.invalidateQueries({ queryKey: getListDocumentsAwaitingApprovalQueryKey() });
        setMsg({ text: 'Responsible merchandiser updated.' });
      },
      onError: (err) => setMsg({ text: apiErrorInfo(err).message, error: true }),
    });
  };
  return <div className="form-field">
    <label htmlFor="responsible-user">Responsible merchandiser</label>
    {manage ? users.isError ? <div className="inline-error">Staff list could not be loaded. <button type="button" className="link-btn" onClick={() => users.refetch()}>Retry</button></div>
      : <select id="responsible-user" className="select status-select" style={{ minWidth: 220 }} value={current} disabled={users.isLoading || set.isPending} onChange={(e) => change(e.target.value)} data-testid="select-responsible">
        <option value="">{users.isLoading ? 'Loading staff…' : 'Not assigned'}</option>
        {active.map((u) => <option key={u.id} value={u.id}>{u.name || u.email || u.id}</option>)}
        {current && !active.some((u) => u.id === current) && <option value={current}>{name(current) ?? 'Current (inactive)'}</option>}
      </select>
      : <div style={{ fontSize: 12, color: '#5d706c' }} data-testid="text-responsible">{current ? 'Assigned' : 'Not assigned'}</div>}
    {msg && <div role={msg.error ? 'alert' : 'status'} style={{ fontSize: 11, marginTop: 5, color: msg.error ? '#913f36' : '#38654e' }}>{msg.text}</div>}
  </div>;
}
