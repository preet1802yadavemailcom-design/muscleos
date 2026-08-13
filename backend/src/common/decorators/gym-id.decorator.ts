import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUserPayload } from './current-user.decorator';
import { UserRole } from '@prisma/client';

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
 */
export const GymId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as CurrentUserPayload | undefined;

    if (user?.role === UserRole.SUPER_ADMIN) {
      // Deliberate, explicit override only — not a fallback for missing auth.
      const override = request.headers['x-gym-id'] as string | undefined;
      return override || undefined;
    }

    return user?.gymId ?? undefined;
  },
);
