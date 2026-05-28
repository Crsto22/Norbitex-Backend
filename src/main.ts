import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import express from 'express';
import { resolve } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOrigins = getCorsOrigins();

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.use(cookieParser());
  app.use('/storage', express.static(getLocalStorageRoot()));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

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
