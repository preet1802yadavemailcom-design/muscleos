import { UserRole } from '@prisma/client';

/**
 * Static RBAC permission matrix.
 * Format: "<resource>:<action>" e.g. "members:create", "reports:export".
 * Super Admin implicitly bypasses this (see hasPermission below).
 */
export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  [UserRole.SUPER_ADMIN]: ['*'],

  [UserRole.GYM_OWNER]: [
    'dashboard:view',
    'members:create', 'members:read', 'members:update', 'members:delete', 'members:export',
    'batches:create', 'batches:read', 'batches:update', 'batches:delete',
    'attendance:read', 'attendance:export',
    'memberships:create', 'memberships:read', 'memberships:update', 'memberships:freeze', 'memberships:transfer',
    'payments:create', 'payments:read', 'payments:refund', 'payments:export',
    'reports:read', 'reports:export',
    'notifications:create', 'notifications:read',
    'settings:read', 'settings:update',
    'users:create', 'users:read', 'users:update', 'users:delete',
  ],

  [UserRole.TRAINER]: [
    'dashboard:view',
    'members:read',
    'batches:read',
    'attendance:read', 'attendance:create',
    'memberships:read',
  ],

  [UserRole.RECEPTIONIST]: [
    'dashboard:view',
    'members:create', 'members:read', 'members:update',
    'batches:read',
    'attendance:read', 'attendance:create',
    'memberships:read', 'memberships:renew',
    'payments:create', 'payments:read',
    'reception:view',
  ],

  [UserRole.MEMBER]: [
    'profile:read', 'profile:update',
    'attendance:read:own',
    'memberships:read:own',
    'payments:read:own',
  ],
};

export function getPermissionsForRole(role: UserRole): string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(userPermissions: string[], required: string): boolean {
  return userPermissions.includes('*') || userPermissions.includes(required);
}
