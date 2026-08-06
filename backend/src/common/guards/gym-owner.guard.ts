import { CurrentUserPayload } from '@common/decorators/current-user.decorator';
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';

@Injectable()
export class GymOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as CurrentUserPayload;
    const gymId = request.headers['x-gym-id'] as string || request.gymId;

    if (!user) throw new ForbiddenException('User not authenticated');
    if (user.role === UserRole.SUPER_ADMIN) return true;
    if (user.role === UserRole.GYM_OWNER && user.gymId !== gymId) {
      throw new ForbiddenException('You can only access your own gym data');
    }
    if (user.gymId && user.gymId !== gymId) {
      throw new ForbiddenException('Invalid gym access');
    }
    return true;
  }
}
