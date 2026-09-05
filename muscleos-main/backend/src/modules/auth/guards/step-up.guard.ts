import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUserPayload } from '@common/decorators/current-user.decorator';

import { StepUpService } from '../step-up.service';

/** Apply alongside JwtAuthGuard/RolesGuard on destructive/high-risk routes.
 *  Client must first call POST /auth/step-up/verify (password [+ 2FA]) and
 *  send the returned token as `x-step-up-token`. */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(private readonly stepUp: StepUpService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as CurrentUserPayload | undefined;
    if (!user) throw new UnauthorizedException('Authentication required');

    const token = request.headers['x-step-up-token'] as string | undefined;
    if (!token) {
      throw new UnauthorizedException('This action requires re-authentication — call /auth/step-up/verify first');
    }
    const ok = await this.stepUp.consume(user.userId, token);
    if (!ok) {
      throw new UnauthorizedException('Step-up authentication expired or already used — please re-verify');
    }
    return true;
  }
}
