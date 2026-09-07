import { createHash } from 'crypto';

import { RedisService } from '@database/redis.service';
import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
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

    const requestHash = createHash('sha256')
      .update(`${request.method}:${request.originalUrl || request.url}:${JSON.stringify(request.body || {})}`)
      .digest('hex');

    const acquired = await this.redis.setNx(
      redisKey,
      JSON.stringify({ status: 'PENDING', requestHash, createdAt: Date.now() }),
      IDEMPOTENCY_TTL_SECONDS,
    );

    if (!acquired) {
      const existing = await this.redis.get(redisKey);
      if (existing) {
        try {
          const parsed = JSON.parse(existing);
          if (parsed.requestHash && parsed.requestHash !== requestHash) {
            throw new BadRequestException(
              'Idempotency key was previously used with a different request payload or endpoint.',
            );
          }
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
          if (e instanceof ConflictException || e instanceof BadRequestException) throw e;
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
                requestHash,
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
