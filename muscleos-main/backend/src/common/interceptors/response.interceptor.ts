import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
  timestamp: string;
  requestId: string;
  path: string;
  meta?: Record<string, any>;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = request.headers['x-request-id'] as string || 'unknown';
    const path = request.url;

    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && 'success' in data) return data;
        const meta = data && typeof data === 'object' && 'meta' in data ? data.meta : undefined;
        const responseData = data && typeof data === 'object' && 'meta' in data ? data.data : data;

        return {
          success: true,
          data: responseData,
          message: 'Request completed successfully',
          timestamp: new Date().toISOString(),
          requestId,
          path,
          ...(meta && { meta }),
        };
      }),
    );
  }
}
