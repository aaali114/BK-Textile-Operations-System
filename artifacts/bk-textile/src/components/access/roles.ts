import type { CurrentUser, UserAccount, UserRoleUpdateRole } from '@workspace/api-client-react';

/** Capacity and last-administrator checks remain authoritative on the server. */
export function roleChoices(actor: CurrentUser, target: UserAccount): UserRoleUpdateRole[] {
  if (actor.status !== 'active' || !actor.canManageUsers || actor.role !== 'admin') return [];
  if (target.id === actor.userId) return ['deputy', 'user'];
  if (target.role === 'admin') return [];
  const choices: UserRoleUpdateRole[] = target.status === 'active' ? ['admin'] : [];
  if (target.role === 'deputy') choices.push('user');
  else if (target.status === 'active') choices.push('deputy');
  return choices;
}
