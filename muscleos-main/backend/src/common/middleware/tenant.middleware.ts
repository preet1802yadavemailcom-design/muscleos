import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      gymId?: string;
    }
  }
}

/**
 * SECURITY: this middleware intentionally does nothing with `x-gym-id`
 * anymore. It used to copy the header onto `req.gymId`, which multiple
 * places (`@GymId()`, `GymOwnerGuard`) then trusted as the tenant id —
 * a client-supplied header is not authorization. Tenant scoping now comes
 * exclusively from the JWT-verified user (see gym-id.decorator.ts).
 * Kept as a no-op middleware (rather than removed) so `req.gymId` stays a
 * known-safe, always-undefined field if any legacy code still reads it.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    next();
  }
}
