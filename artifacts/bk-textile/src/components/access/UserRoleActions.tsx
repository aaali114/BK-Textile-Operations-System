import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Crown, ShieldCheck, UserMinus, X } from 'lucide-react';
import { getGetCurrentUserQueryKey, getListUsersQueryKey, useSetUserRole } from '@workspace/api-client-react';
import type { CurrentUser, UserAccount, UserRoleUpdateRole } from '@workspace/api-client-react';
import { apiErrorInfo } from '../orders/helpers';
import { roleChoices } from './roles';

type Props = {
  actor: CurrentUser;
  user: UserAccount;
  users: UserAccount[];
  disabled: boolean;
  onChanged: (user: UserAccount) => void;
  onBusyChange: (busy: boolean) => void;
};

const roleName = (role: UserRoleUpdateRole) => role === 'admin' ? 'administrator' : role === 'deputy' ? 'deputy' : 'staff user';

export function UserRoleActions({ actor, user, users, disabled, onChanged, onBusyChange }: Props) {
  const client = useQueryClient();
  const mutation = useSetUserRole();
  const [pendingRole, setPendingRole] = useState<UserRoleUpdateRole | null>(null);
  const [typed, setTyped] = useState('');
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const self = user.id === actor.userId;
  const identity = user.email || user.id;
  const name = user.name || identity;
  const typedRequired = pendingRole === 'admin' || self;
  const choices = roleChoices(actor, user);
  if (actor.role !== 'admin' || !actor.canManageUsers) return null;

  const begin = (role: UserRoleUpdateRole) => {
    setTyped(''); setFeedback(null); setPendingRole(role);
  };
  const save = () => {
    if (!pendingRole || !choices.includes(pendingRole) || disabled || mutation.isPending || (typedRequired && typed.trim() !== identity)) return;
    onBusyChange(true);
    if (self) window.dispatchEvent(new CustomEvent('bk:admin-transfer-start'));
    mutation.mutate({ userId: user.id, data: { role: pendingRole } }, {
      onSuccess: async (saved) => {
        onChanged(saved);
        setPendingRole(null);
        if (self) {
          try {
            await client.refetchQueries({ queryKey: getGetCurrentUserQueryKey() }, { throwOnError: true });
          } catch {
            setFeedback({ error: true, message: 'Your role was changed, but updated access could not be loaded. Reload before making further changes.' });
            return;
          }
          window.dispatchEvent(new CustomEvent('bk:admin-transfer-end'));
        }
        onBusyChange(false);
        setFeedback({ message: `${name} is now ${saved.role === 'admin' ? 'an' : 'a'} ${roleName(saved.role)}.` });
      },
      onError: (error) => {
        if (self) window.dispatchEvent(new CustomEvent('bk:admin-transfer-end'));
        onBusyChange(false);
        setPendingRole(null);
        setFeedback({ error: true, message: apiErrorInfo(error).message });
        void client.invalidateQueries({ queryKey: getListUsersQueryKey() });
      },
    });
  };

  return <div className="ua-editor-body" data-testid="panel-role-actions" style={{ borderTop: '1px solid var(--line)' }}>
    <div className="ua-section-label"><span>Administrator actions</span></div>
    <p className="support-note" data-testid="text-role-capacity">
      Administrators: {users.filter(u => u.role === 'admin').length}/2 · Deputies: {users.filter(u => u.role === 'deputy').length}/2.
      {' '}Appointing another administrator does not remove your own role. The server checks availability when you save.
    </p>
    {feedback && <div className={`feedback ${feedback.error ? 'error' : 'success'}`} role={feedback.error ? 'alert' : 'status'} data-testid="text-role-feedback">{feedback.message}</div>}
    {!self && user.role === 'admin'
      ? <p className="ua-lock" data-testid="text-role-locked">An administrator can only step down themselves; you cannot change another administrator.</p>
      : <div className="ua-role-actions">
        {choices.includes('admin') && <button type="button" className="btn btn-quiet" disabled={disabled || mutation.isPending} onClick={() => begin('admin')} data-testid="button-make-admin"><Crown size={14} />Make administrator</button>}
        {choices.includes('deputy') && <button type="button" className="btn btn-quiet" disabled={disabled || mutation.isPending} onClick={() => begin('deputy')} data-testid={self ? 'button-step-down-deputy' : 'button-make-deputy'}><ShieldCheck size={14} />{self ? 'Step down to deputy' : 'Make deputy'}</button>}
        {choices.includes('user') && <button type="button" className="btn btn-quiet" disabled={disabled || mutation.isPending} onClick={() => begin('user')} data-testid={self ? 'button-step-down-user' : 'button-remove-deputy'}><UserMinus size={14} />{self ? 'Step down to staff user' : 'Remove deputy'}</button>}
        {user.status !== 'active' && <p className="support-note">Approve this user before appointing them to a role.</p>}
        {disabled && <p className="support-note">Save or cancel access changes before changing roles.</p>}
      </div>}
    {pendingRole && createPortal(<div className="modal-scrim" onClick={() => !mutation.isPending && setPendingRole(null)}>
      <section role="dialog" aria-modal="true" aria-label="Confirm role change" className="modal" style={{ maxWidth: 520 }} onClick={event => event.stopPropagation()} data-testid="dialog-confirm-role">
        <div className="modal-head"><h2 className="panel-title">{self ? 'Step down' : `Make ${name}`} {self ? `to ${roleName(pendingRole)}?` : `${pendingRole === 'admin' ? 'an' : 'a'} ${roleName(pendingRole)}?`}</h2><button type="button" className="icon-btn" aria-label="Close role confirmation" disabled={mutation.isPending} onClick={() => setPendingRole(null)}><X size={16} /></button></div>
        <div className="modal-content">
          <p>{self ? 'You will lose administrator controls. Another active administrator must remain; a deputy seat must also be available when stepping down to deputy.' : pendingRole === 'admin' ? 'This person will be able to appoint administrators and deputies, approve users, and grant access. You remain an administrator.' : pendingRole === 'deputy' ? 'This person will be able to approve users and grant access within the deputy safeguards.' : 'This person will no longer manage users. Their area access is unchanged.'}</p>
          {typedRequired && <label style={{ display: 'grid', gap: 8 }}>Type {identity} to confirm<input className="field" value={typed} autoComplete="off" onChange={event => setTyped(event.target.value)} data-testid="input-confirm-role" /></label>}
        </div>
        <div className="modal-actions"><button type="button" className="btn btn-quiet" disabled={mutation.isPending} onClick={() => setPendingRole(null)}>Cancel</button><button type="button" className="btn btn-primary" disabled={disabled || mutation.isPending || (typedRequired && typed.trim() !== identity)} onClick={save} data-testid="button-confirm-role">{mutation.isPending ? 'Saving…' : 'Confirm role change'}</button></div>
      </section>
    </div>, document.body)}
  </div>;
}
