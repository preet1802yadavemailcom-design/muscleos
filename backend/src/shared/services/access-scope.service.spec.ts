import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AccessScopeService } from './access-scope.service';

describe('AccessScopeService', () => {
  let service: AccessScopeService;

  beforeEach(() => {
    service = new AccessScopeService();
  });

  describe('isBranchScoped', () => {
    it('returns false for SUPER_ADMIN regardless of branchId', () => {
      const user = { userId: 'u1', email: 'sa@test.com', role: UserRole.SUPER_ADMIN, branchId: 'b1', permissions: [] };
      expect(service.isBranchScoped(user as any)).toBe(false);
    });

    it('returns false for GYM_OWNER regardless of branchId', () => {
      const user = { userId: 'u2', email: 'owner@test.com', role: UserRole.GYM_OWNER, branchId: 'b1', permissions: [] };
      expect(service.isBranchScoped(user as any)).toBe(false);
    });

    it('returns true for RECEPTIONIST with branchId', () => {
      const user = { userId: 'u3', email: 'rec@test.com', role: UserRole.RECEPTIONIST, branchId: 'b1', permissions: [] };
      expect(service.isBranchScoped(user as any)).toBe(true);
    });

    it('returns false for RECEPTIONIST without branchId', () => {
      const user = { userId: 'u4', email: 'rec@test.com', role: UserRole.RECEPTIONIST, branchId: undefined, permissions: [] };
      expect(service.isBranchScoped(user as any)).toBe(false);
    });
  });

  describe('assertBranchAccess', () => {
    it('allows access for GYM_OWNER to any branch', () => {
      const owner = { userId: 'u1', email: 'owner@test.com', role: UserRole.GYM_OWNER, permissions: [] };
      expect(() => service.assertBranchAccess(owner as any, 'branch-99')).not.toThrow();
    });

    it('allows access for RECEPTIONIST to their own branch', () => {
      const staff = { userId: 'u2', email: 'rec@test.com', role: UserRole.RECEPTIONIST, branchId: 'branch-1', permissions: [] };
      expect(() => service.assertBranchAccess(staff as any, 'branch-1')).not.toThrow();
    });

    it('throws ForbiddenException for RECEPTIONIST accessing another branch', () => {
      const staff = { userId: 'u2', email: 'rec@test.com', role: UserRole.RECEPTIONIST, branchId: 'branch-1', permissions: [] };
      expect(() => service.assertBranchAccess(staff as any, 'branch-2')).toThrow(ForbiddenException);
    });
  });

  describe('applyBranchScope', () => {
    it('appends branchId if user is branch-scoped', () => {
      const staff = { userId: 'u2', email: 'rec@test.com', role: UserRole.RECEPTIONIST, branchId: 'branch-1', permissions: [] };
      const where = { gymId: 'gym-1', status: 'ACTIVE' };
      const result = service.applyBranchScope(where, staff as any);
      expect(result).toEqual({ gymId: 'gym-1', status: 'ACTIVE', branchId: 'branch-1' });
    });

    it('leaves where unchanged if user is GYM_OWNER', () => {
      const owner = { userId: 'u1', email: 'owner@test.com', role: UserRole.GYM_OWNER, branchId: 'branch-1', permissions: [] };
      const where = { gymId: 'gym-1', status: 'ACTIVE' };
      const result = service.applyBranchScope(where, owner as any);
      expect(result).toEqual({ gymId: 'gym-1', status: 'ACTIVE' });
    });
  });
});
