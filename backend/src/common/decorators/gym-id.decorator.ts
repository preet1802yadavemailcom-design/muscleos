import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const GymId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.headers['x-gym-id'] as string || request.gymId;
  },
);
