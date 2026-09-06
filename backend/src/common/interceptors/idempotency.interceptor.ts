import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { RedisService } from '@database/redis.service';
import { Request, Response } from 'express';
import { Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly redis: RedisService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const rawKey =
      (request.headers['idempotency-key'] as string) ||
      (request.headers['x-idempotency-key'] as string);

    if (!rawKey) {
      return next.handle();
    }

    const tenantOrUser =
      (request as any).gymId ||
      (request.user as any)?.gymId ||
      (request.user as any)?.userId ||
      'global';

    const redisKey = `idempotency:${tenantOrUser}:${rawKey.trim()}`;

    const acquired = await this.redis.setNx(
      redisKey,
      JSON.stringify({ status: 'PENDING', createdAt: Date.now() }),
      IDEMPOTENCY_TTL_SECONDS,
    );

    if (!acquired) {
      const existing = await this.redis.get(redisKey);
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          if (parsed.status === 'PENDING') {
            throw new ConflictException(
              'A request with this Idempotency-Key is currently processing. Please try again shortly.',
            );
          }
          if (parsed.status === 'COMPLETED') {
            if (parsed.statusCode) {
              response.status(parsed.statusCode);
            }
            return of(parsed.body);
          }
        } catch (e) {
          if (e instanceof ConflictException) throw e;
        }
      }
      throw new ConflictException('Concurrent mutation with duplicate Idempotency-Key.');
    }

    return next.handle().pipe(
      tap({
        next: async (resData) => {
          try {
            await this.redis.set(
              redisKey,
              JSON.stringify({
                status: 'COMPLETED',
                statusCode: response.statusCode,
                body: resData,
                completedAt: Date.now(),
              }),
              IDEMPOTENCY_TTL_SECONDS,
            );
          } catch {
            // best-effort cache write
          }
        },
      }),
      catchError((err) => {
        // If execution failed with an exception, release the key so caller can retry with corrected params
        this.redis.del(redisKey).catch(() => undefined);
        return throwError(() => err);
      }),
    );
  }
}
