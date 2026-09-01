import { UserRole } from '@prisma/client';

export const PERMISSIONS = {
  UseApp: 'app.use',
  ApproveKyc: 'kyc.approve',
  ForceLogoutUser: 'session.force_logout',
  SearchUsers: 'user.search',
  EditTransaction: 'tx.edit',
  SoftDeleteTransaction: 'tx.soft_delete',
  PromoteUser: 'user.promote',
  BulkOverride: 'tx.bulk_override',
  ToggleDemoOverrideMode: 'system.toggle_demo_override',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const customer: Permission[] = [PERMISSIONS.UseApp];

const admin: Permission[] = [
  ...customer,
  PERMISSIONS.ApproveKyc,
  PERMISSIONS.ForceLogoutUser,
  PERMISSIONS.SearchUsers,
  PERMISSIONS.EditTransaction,
  PERMISSIONS.SoftDeleteTransaction,
];

const superadmin: Permission[] = [
  ...admin,
  PERMISSIONS.PromoteUser,
  PERMISSIONS.BulkOverride,
  PERMISSIONS.ToggleDemoOverrideMode,
];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  customer,
  admin,
  superadmin,
};

export function roleHas(role: UserRole, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}
