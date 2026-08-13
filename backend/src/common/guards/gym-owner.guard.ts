import { CurrentUserPayload } from '@common/decorators/current-user.decorator';
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';

/**
 * Defense-in-depth only: `@GymId()` now always resolves the tenant from the
 * JWT-verified user, never from the `x-gym-id` header, so this guard's
 * actual job is done at the decorator level. Kept so a route can still
 * explicitly assert "this role must belong to a gym at all" and to guard
 * against anyone re-introducing a header-based gymId lookup later.
 */
@Injectable()
export class GymOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as CurrentUserPayload;

    if (!user) throw new ForbiddenException('User not authenticated');
    if (user.role === UserRole.SUPER_ADMIN) return true;
    if (!user.gymId) {
      throw new ForbiddenException('No gym associated with this account');
    }
    return true;
  }
}
