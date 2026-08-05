import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { resolve } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const server = app.getHttpAdapter().getInstance() as express.Express;
  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigins = getCorsOrigins();

  server.disable('x-powered-by');
  if (isProduction) server.set('trust proxy', 1);
  app.enableShutdownHooks();

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.use(cookieParser());
  app.use(securityHeaders(isProduction));
  app.use('/storage', express.static(getLocalStorageRoot()));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap().catch((error: unknown) => {
  Logger.error(error, 'No se pudo iniciar Norbitex API');
  process.exitCode = 1;
});

function securityHeaders(isProduction: boolean) {
  return (_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    if (isProduction) {
      response.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  };
}

function getLocalStorageRoot() {
  return resolve(
    process.env.LOCAL_STORAGE_DIR || resolve(process.cwd(), 'storage'),
  );
}

function getCorsOrigins() {
  const origins = process.env.CORS_ORIGINS;

  if (!origins) {
    return reflectCorsOrigin;
  }

  if (origins.trim() === '*') {
    return reflectCorsOrigin;
  }

  return origins.split(',').map((origin) => origin.trim());
}

function reflectCorsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, origin?: string | boolean) => void,
) {
  callback(null, origin ?? true);
}
