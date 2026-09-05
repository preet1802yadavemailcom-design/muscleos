import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { LoggerService } from '@shared/services/logger.service';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;
    const url = request.url;
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
