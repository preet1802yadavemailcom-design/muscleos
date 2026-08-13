import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLogger, format, transports, Logger } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: Logger;

  constructor(private readonly configService: ConfigService) {
    const isDevelopment = this.configService.get('app.environment') === 'development';
    const logLevel = isDevelopment ? 'debug' : 'info';

    const consoleFormat = format.combine(
      format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      format.colorize(),
      format.printf(({ timestamp, level, message, context, ...meta }) => {
        const contextStr = context ? `[${context}]` : '';
        const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
        return `${timestamp} ${level} ${contextStr} ${message}${metaStr}`;
      }),
    );

    const fileFormat = format.combine(
      format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      format.json(),
    );

    const transportList: transports.ConsoleTransportInstance[] = [
      new transports.Console({ format: consoleFormat, level: logLevel }),
    ];

    if (!isDevelopment) {
      transportList.push(
        new DailyRotateFile({
          filename: 'logs/application-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '14d',
          format: fileFormat,
          level: 'info',
        }) as any,
        new DailyRotateFile({
          filename: 'logs/error-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '30d',
          format: fileFormat,
          level: 'error',
        }) as any,
      );
    }

    this.logger = createLogger({
      level: logLevel,
      defaultMeta: { service: 'muscleos-api' },
      transports: transportList,
      exceptionHandlers: [new transports.Console({ format: consoleFormat })],
      rejectionHandlers: [new transports.Console({ format: consoleFormat })],
    });
  }

  log(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.info(message, { context, ...meta });
  }

  error(message: string, trace?: string, context?: string, meta?: Record<string, any>): void {
    this.logger.error(message, { context, trace, ...meta });
  }

  warn(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.warn(message, { context, ...meta });
  }

  debug(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.debug(message, { context, ...meta });
  }

  verbose(message: string, context?: string, meta?: Record<string, any>): void {
    this.logger.verbose(message, { context, ...meta });
  }
}
