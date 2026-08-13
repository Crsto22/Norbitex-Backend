import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ResponseCacheModule } from './common/cache/response-cache.module';
import { RequestMetricsModule } from './common/metrics/request-metrics.module';
import { PdfConcurrencyModule } from './common/pdf/pdf-concurrency.module';
import { AuthModule } from './modules/auth/auth.module';
import { BrandsModule } from './modules/brands/brands.module';
import { BranchesModule } from './modules/branches/branches.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CashRegisterModule } from './modules/cash-register/cash-register.module';
import { ClientsModule } from './modules/clients/clients.module';
import { CreditNotesModule } from './modules/credit-notes/credit-notes.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DocumentoConsultaModule } from './modules/documento-consulta/documento-consulta.module';
import { GuiaRemisionModule } from './modules/guia-remision/guia-remision.module';
import { ColorsModule } from './modules/colors/colors.module';
import { PaymentMethodsModule } from './modules/payment-methods/payment-methods.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { PlatformBillingModule } from './modules/platform-billing/platform-billing.module';
import { PlansModule } from './modules/plans/plans.module';
import { ProductsModule } from './modules/products/products.module';
import { QuotationsModule } from './modules/quotations/quotations.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SalesModule } from './modules/sales/sales.module';
import { SizesModule } from './modules/sizes/sizes.module';
import { SunatConfigModule } from './modules/sunat-config/sunat-config.module';
import { SunatEmissionModule } from './modules/sunat-emission/sunat-emission.module';
import { CompanyModule } from './modules/company/company.module';
import { UsersModule } from './modules/users/users.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StockModule } from './modules/stock/stock.module';
import { PrismaModule } from './prisma/prisma.module';
import { validateEnvironment } from './config/environment';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: numberEnv(configService, 'RATE_LIMIT_TTL_SECONDS', 60) * 1000,
            limit: numberEnv(configService, 'RATE_LIMIT_REQUESTS', 120),
          },
        ],
        getTracker: (request: Record<string, unknown>) =>
          getRateLimitTracker(request),
      }),
    }),
    ScheduleModule.forRoot(),
    ResponseCacheModule,
    RequestMetricsModule,
    PdfConcurrencyModule,
    PrismaModule,
    PlansModule,
    AuthModule,
    ColorsModule,
    SizesModule,
    BrandsModule,
    CategoriesModule,
    CashRegisterModule,
    BranchesModule,
    ClientsModule,
    CreditNotesModule,
    DashboardModule,
    DocumentoConsultaModule,
    GuiaRemisionModule,
    ProductsModule,
    SalesModule,
    QuotationsModule,
    ReportsModule,
    PlatformAdminModule,
    PlatformBillingModule,
    PaymentMethodsModule,
    CompanyModule,
    SunatConfigModule,
    SunatEmissionModule,
    UsersModule,
    NotificationsModule,
    StockModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

function numberEnv(
  configService: ConfigService,
  name: string,
  fallback: number,
) {
  const value = Number(configService.get<string>(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getRateLimitTracker(request: Record<string, unknown>) {
  const headers = request.headers as Record<string, string | string[]>;
  const authorization = headerValue(headers?.authorization);
  if (authorization) {
    return `auth:${createHash('sha256').update(authorization).digest('hex')}`;
  }

  return `ip:${typeof request.ip === 'string' ? request.ip : 'unknown'}`;
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
