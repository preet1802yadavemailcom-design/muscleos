import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '@common/interceptors/response.interceptor';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import { LoggerService } from '@shared/services/logger.service';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';

import { AppModule } from './app.module';


async function bootstrap() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0.1,
    });
  }

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Needed to verify Razorpay/Stripe webhook HMAC signatures against the exact raw bytes.
    rawBody: true,
  });

  const configService = app.get(ConfigService);
  const logger = app.get(LoggerService);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  app.use(cookieParser(configService.get('COOKIE_SECRET', 'muscleos_cookie_secret')));

  app.enableCors({
    origin: configService.get('FRONTEND_URL', 'http://localhost:5173'),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Gym-ID', 'X-Request-ID'],
  });

  app.use(morgan('combined', {
    stream: {
      write: (message: string) => logger.log(message.trim(), 'HTTP'),
    },
  }));

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'api/v',
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  }));

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(logger));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('MuscleOS API')
    .setDescription('Enterprise Gym Management System API')
    .setVersion('1.0.0')
    .setContact('MuscleOS Support', 'https://muscleos.com', 'support@muscleos.com')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Gym-ID' }, 'gym-id')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    deepScanRoutes: true,
    operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
  });

  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'MuscleOS API Documentation',
    customCss: '.swagger-ui .topbar { display: none }',
  });

  app.enableShutdownHooks();

  const port = configService.get('PORT', 3000);
  await app.listen(port);

  logger.log(`🚀 MuscleOS API running on port ${port}`, 'Bootstrap');
  logger.log(`📚 Swagger docs at http://localhost:${port}/api/docs`, 'Bootstrap');
}

bootstrap();
