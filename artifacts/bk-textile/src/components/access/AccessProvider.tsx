import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetCurrentUserQueryKey, useGetCurrentUser } from '@workspace/api-client-react';
import type { CurrentUser, Permission } from '@workspace/api-client-react';
import { apiErrorInfo } from '../orders/helpers';
import { canReadArea, canWriteArea, firstAllowedPath, hasPermission, type Area } from './policy';

const AccessContext = createContext<CurrentUser | undefined>(undefined);
/** True inside an order that is in the Bin: everything below is read-only (the API refuses changes with 409). */
const ReadOnlyContext = createContext(false);
export function ReadOnlyScope({ locked, children }: { locked: boolean; children: ReactNode }) {
  return <ReadOnlyContext.Provider value={locked}>{children}</ReadOnlyContext.Provider>;
}
export function useAccess() {
  const user = useContext(AccessContext);
  const locked = useContext(ReadOnlyContext);
  return {
    user,
    locked,
    canRead: (area: Area) => canReadArea(user, area),
    canWrite: (area: Area) => !locked && canWriteArea(user, area),
    hasPermission: (permission: Permission) => !locked && hasPermission(user, permission),
    canManageUsers: !locked && user?.status === 'active' && user.canManageUsers === true,
    homePath: user ? firstAllowedPath(user) : '/access',
  };
}

export function AccountScreen({ title, email, children }: { title: string; email?: string | null; children?: ReactNode }) {
  const { signOut } = useClerk();
  return <main className="account-status-screen" style={{ minHeight: '100dvh', padding: 24, display: 'grid', placeItems: 'center', background: '#21343b', color: '#22343b' }}>
    <section className="panel" style={{ maxWidth: 560, padding: 28, width: '100%' }}>
      <div className="eyebrow">B.K. Textile · Account access</div>
      <h1 style={{ fontSize: 24, margin: '14px 0' }} data-testid="text-access-status">{title}</h1>
      {email && <p style={{ overflowWrap: 'anywhere' }} data-testid="text-access-email">{email}</p>}
      {children}
      <button type="button" className="btn btn-quiet" style={{ marginTop: 16 }} data-testid="button-access-sign-out"
        onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL })}>Sign out</button>
    </section>
  </main>;
}

export function AccessProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const meKey = getGetCurrentUserQueryKey();
  const me = useGetCurrentUser({ query: {
    queryKey: meKey, staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: true, retry: false,
  } });
  useEffect(() => {
    if (me.data && me.data.status !== 'active') {
      void client.cancelQueries({ predicate: (query) => query.queryKey[0] !== meKey[0] });
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== meKey[0] });
    }
  }, [client, me.data?.status, meKey[0]]);
  // Access may be revoked while a session is open. Let the account gate react to
  // the API's explicit status code, rather than leaving staff on a generic error.
  useEffect(() => client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error' || event.query.queryKey[0] === meKey[0]) return;
    const error = event.query.state.error as { status?: number; data?: { code?: string } } | null;
    if (error?.status !== 403) return;
    const code = error.data?.code;
    if (code === 'pending_approval' || code === 'disabled') {
      client.setQueryData<CurrentUser>(meKey, (current) => current ? { ...current, status: code === 'disabled' ? 'disabled' : 'pending' } : current);
    }
    void client.invalidateQueries({ queryKey: meKey });
  }), [client, meKey[0]]);
  if (me.isPending) return <main className="auth-loading" role="status">Loading your access…</main>;
  if (me.isError) return <AccountScreen title="Your access could not be loaded">
    <p role="alert">{apiErrorInfo(me.error).message}</p>
    <button type="button" className="btn btn-primary" onClick={() => me.refetch()} data-testid="button-retry-access">Try again</button>
  </AccountScreen>;
  if (me.data.status === 'pending') return <AccountScreen title="Waiting for administrator approval" email={me.data.email}>
    <p>Your account is registered. An administrator or deputy must approve your access before you can use the operations system.</p>
  </AccountScreen>;
  if (me.data.status === 'disabled') return <AccountScreen title="Your access has been removed" email={me.data.email}>
    <p>Contact your administrator if you need access restored.</p>
  </AccountScreen>;
  // Discard open editors and confirmations when effective grants change.
  const accessKey = JSON.stringify([me.data.userId, me.data.role, me.data.canManageUsers, me.data.areas, me.data.permissions]);
  return <AccessContext.Provider key={accessKey} value={me.data}>{children}</AccessContext.Provider>;
}
