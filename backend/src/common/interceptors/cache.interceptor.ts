import { RedisService } from '@database/redis.service';
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { LoggerService } from '@shared/services/logger.service';
import { Request } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: LoggerService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<Request>();
    const cacheKey = this.generateCacheKey(request);
    const ttl = 300;

    if (request.method !== 'GET') return next.handle();

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit: ${cacheKey}`, 'Cache');
        return of(JSON.parse(cached));
      }
    } catch (error) {
      this.logger.warn(`Cache read error: ${error.message}`, 'Cache');
    }

    return next.handle().pipe(
      tap(async (data) => {
        try {
          await this.redis.set(cacheKey, JSON.stringify(data), ttl);
          this.logger.debug(`Cache set: ${cacheKey} (TTL: ${ttl}s)`, 'Cache');
        } catch (error) {
          this.logger.warn(`Cache write error: ${error.message}`, 'Cache');
        }
      }),
    );
  }

  private generateCacheKey(request: Request): string {
    const gymId = request.headers['x-gym-id'] || 'global';
    const userId = (request.user as any)?.userId || 'anonymous';
    return `cache:${gymId}:${userId}:${request.method}:${request.url}`;
  }
}
