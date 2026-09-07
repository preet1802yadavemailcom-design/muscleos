import { CurrentUserPayload } from '@common/decorators/current-user.decorator';
import { Injectable, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

@Injectable()
export class AccessScopeService {
  /**
   * Determines if the current user is restricted to a specific branch.
   * SUPER_ADMIN and GYM_OWNER have organization-wide access across all branches.
   * Other roles (RECEPTIONIST, TRAINER, MEMBER) are branch-scoped if branchId is set.
   */
  isBranchScoped(user?: CurrentUserPayload | null): boolean {
    if (!user) return false;
    if (user.role === UserRole.SUPER_ADMIN || user.role === UserRole.GYM_OWNER) {
      return false;
    }
    return !!user.branchId;
  }

  /**
   * Returns the branchId to filter by, or undefined if the user has org-wide access.
   */
  getBranchId(user?: CurrentUserPayload | null): string | undefined {
    return this.isBranchScoped(user) ? user!.branchId : undefined;
  }

  /**
   * Asserts that the caller has permission to view or mutate a record associated with targetBranchId.
   * Throws 403 ForbiddenException if there is a cross-branch violation.
   */
  assertBranchAccess(user: CurrentUserPayload | undefined | null, targetBranchId?: string | null): void {
    if (!this.isBranchScoped(user)) return;
    if (!targetBranchId) return; // Target record is org-wide
    if (user!.branchId !== targetBranchId) {
      throw new ForbiddenException('Access denied: You do not have permission to access records for another branch.');
    }
  }

  /**
   * Augments a Prisma query where clause with branch scoping if applicable.
   */
  applyBranchScope<T extends Record<string, any>>(where: T, user?: CurrentUserPayload | null, branchField = 'branchId'): T {
    if (!this.isBranchScoped(user)) return where;
    return {
      ...where,
      [branchField]: user!.branchId,
    };
  }
}
