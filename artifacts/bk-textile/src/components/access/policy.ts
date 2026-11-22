import type { AreaAccess, CurrentUser, OrderUpdate, Permission } from '@workspace/api-client-react';

export type Area = keyof AreaAccess;
export const AREA_LABELS: Record<Area, string> = {
  dashboard: 'Operations desk',
  merchandising: 'Order register',
  department_work: 'Department work',
  materials: 'Materials & lots',
  quality: 'Quality inspections',
};
export const AREA_PATHS: Record<Area, string> = {
  dashboard: '/dashboard', merchandising: '/orders', department_work: '/workflows', materials: '/materials', quality: '/quality',
};
export function canReadArea(user: CurrentUser | undefined, area: Area) {
  return user?.status === 'active' && (user.areas[area] === 'read' || user.areas[area] === 'write');
}
export function canWriteArea(user: CurrentUser | undefined, area: Area) {
  return user?.status === 'active' && user.areas[area] === 'write';
}
export function hasPermission(user: CurrentUser | undefined, permission: Permission) {
  return user?.status === 'active' && user.permissions.includes(permission);
}
export function firstAllowedPath(user: CurrentUser) {
  const first = (Object.keys(AREA_PATHS) as Area[]).find((area) => canReadArea(user, area));
  return first ? AREA_PATHS[first] : user.canManageUsers ? '/users' : '/access';
}

/** Never send locked commercial fields, including their unchanged/null values. */
export function permittedOrderUpdate(data: OrderUpdate, commercial: boolean): OrderUpdate {
  if (commercial) return data;
  const result: OrderUpdate = {};
  for (const key of ['style', 'description', 'status', 'priority', 'pcsPerCarton', 'garmentDescription'] as const) {
    if (data[key] !== undefined) Object.assign(result, { [key]: data[key] });
  }
  return result;
}
