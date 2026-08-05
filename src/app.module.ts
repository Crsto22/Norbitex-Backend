import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
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
    ScheduleModule.forRoot(),
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
  providers: [AppService],
})
export class AppModule {}
