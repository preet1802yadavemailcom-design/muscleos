import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { LoggerService } from '@shared/services/logger.service';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.headers['x-request-id'] as string || 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: any[] | null = null;
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || exception.message;
        errors = (exceptionResponse as any).errors || null;
        code = (exceptionResponse as any).code || `HTTP_${status}`;
      } else {
        message = exceptionResponse;
        code = `HTTP_${status}`;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      code = exception.name || 'UNKNOWN_ERROR';
    }

    const logMessage = `[${requestId}] ${request.method} ${request.url} - ${status}: ${message}`;
    if (status >= 500) {
      this.logger.error(logMessage, (exception as Error)?.stack, 'ExceptionFilter');
      // Only unexpected 5xx errors are worth an error-tracking event; 4xx are
      // client mistakes and would just add noise to Sentry.
      if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
          scope.setTag('requestId', requestId);
          scope.setContext('request', { method: request.method, url: request.url });
          Sentry.captureException(exception);
        });
      }
    } else {
      this.logger.warn(logMessage, 'ExceptionFilter');
    }

    response.status(status).json({
      success: false,
      data: null,
      message,
      code,
      errors,
      timestamp: new Date().toISOString(),
      requestId,
      path: request.url,
    });
  }
}
