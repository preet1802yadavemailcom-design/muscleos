import { createParamDecorator, ExecutionContext, ForbiddenException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';

import { CurrentUserPayload } from './current-user.decorator';

/**
 * SECURITY: resolves the tenant (gym) id from the AUTHENTICATED JWT user,
 * never from the `x-gym-id` request header. The header/tenant-middleware
 * value is attacker-controlled — a previous version of this decorator read
 * it directly, which meant any controller route that used `@GymId()`
 * without ALSO remembering to apply `GymOwnerGuard` was a cross-tenant IDOR
 * (confirmed exploitable on `GymsController` — `GET/PUT /gyms/me` and its
 * dashboard routes had no `GymOwnerGuard`, so a GYM_OWNER could read/update
 * another organization's profile just by sending a different `x-gym-id`).
 *
 * Only SUPER_ADMIN may act on a gym other than their own (they have none),
 * and only via an explicit, intentional `x-gym-id` override — every other
 * role always gets their own JWT-verified gymId, full stop.
 *
 * If no valid gym context is present, an exception is thrown to prevent
 * accidental cross-tenant leaks caused by Prisma omitting undefined where clauses.
 */
export const GymId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as CurrentUserPayload | undefined;

    if (user?.role === UserRole.SUPER_ADMIN) {
      const override = request.headers['x-gym-id'] as string | undefined;
      if (!override) {
        throw new BadRequestException('SUPER_ADMIN must specify a target gym using the x-gym-id header.');
      }
      return override;
    }

    if (!user?.gymId) {
      throw new ForbiddenException('No gym associated with this account.');
    }

    return user.gymId;
  },
);
