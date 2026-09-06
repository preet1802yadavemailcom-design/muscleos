import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { LoggerService } from '@shared/services/logger.service';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const SENSITIVE_QUERY_PARAMS = ['access_token', 'token', 'otp', 'secret', 'password', 'key', 'refresh_token', 'apikey', 'authorization'];

function sanitizeUrl(rawUrl: string): string {
  try {
    const [path, query] = rawUrl.split('?');
    if (!query) return rawUrl;
    const params = new URLSearchParams(query);
    for (const key of Array.from(params.keys())) {
      if (SENSITIVE_QUERY_PARAMS.some((p) => key.toLowerCase().includes(p.toLowerCase()))) {
        params.set(key, '[REDACTED]');
      }
    }
    const sanitizedQuery = params.toString();
    return sanitizedQuery ? `${path}?${sanitizedQuery}` : path;
  } catch {
    return rawUrl;
  }
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;
    const url = sanitizeUrl(request.url);
    const requestId = request.headers['x-request-id'] as string || 'unknown';
    const userAgent = request.get('user-agent') || 'unknown';
    const ip = request.ip;
    const userId = (request.user as any)?.userId || 'anonymous';
    const now = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          const statusCode = response.statusCode;
          const duration = Date.now() - now;
          this.logger.log(
            `${method} ${url} ${statusCode} - ${duration}ms - ${userId} - ${ip} - ${userAgent}`,
            'HTTP',
            { requestId, duration, statusCode },
          );
        },
        error: (error) => {
          const duration = Date.now() - now;
          const statusCode = error.status || 500;
          this.logger.error(
            `${method} ${url} ${statusCode} - ${duration}ms - ${error.message}`,
            error.stack,
            'HTTP',
            { requestId, duration, statusCode },
          );
        },
      }),
    );
  }
}
