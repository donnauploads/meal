import { PERMISSIONS, roleHas } from './permissions';

describe('RBAC permissions matrix', () => {
  it('only superadmin can promote and bulk override', () => {
    expect(roleHas('superadmin' as any, PERMISSIONS.PromoteUser)).toBe(true);
    expect(roleHas('admin' as any, PERMISSIONS.PromoteUser)).toBe(false);
    expect(roleHas('admin' as any, PERMISSIONS.BulkOverride)).toBe(false);
    expect(roleHas('customer' as any, PERMISSIONS.BulkOverride)).toBe(false);
  });
  it('admin can edit and soft-delete transactions', () => {
    expect(roleHas('admin' as any, PERMISSIONS.EditTransaction)).toBe(true);
    expect(roleHas('admin' as any, PERMISSIONS.SoftDeleteTransaction)).toBe(true);
    expect(roleHas('customer' as any, PERMISSIONS.EditTransaction)).toBe(false);
  });
});
