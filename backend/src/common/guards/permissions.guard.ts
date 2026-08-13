import { hasPermission } from '@common/constants/role-permissions.constant';
import { CurrentUserPayload } from '@common/decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '@common/decorators/permissions.decorator';
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as CurrentUserPayload;
    if (!user) throw new ForbiddenException('User not authenticated');

    const hasPermissions = requiredPermissions.every((permission) =>
      hasPermission(user.permissions ?? [], permission),
    );
    if (!hasPermissions) {
      throw new ForbiddenException(`Access denied. Required permissions: ${requiredPermissions.join(', ')}`);
    }
    return true;
  }
}
