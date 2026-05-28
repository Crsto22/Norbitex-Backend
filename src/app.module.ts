import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { BrandsModule } from './modules/brands/brands.module';
import { BranchesModule } from './modules/branches/branches.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CashRegisterModule } from './modules/cash-register/cash-register.module';
import { ClientsModule } from './modules/clients/clients.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ColorsModule } from './modules/colors/colors.module';
import { PaymentMethodsModule } from './modules/payment-methods/payment-methods.module';
import { ProductsModule } from './modules/products/products.module';
import { QuotationsModule } from './modules/quotations/quotations.module';
import { SalesModule } from './modules/sales/sales.module';
import { SizesModule } from './modules/sizes/sizes.module';
import { SunatConfigModule } from './modules/sunat-config/sunat-config.module';
import { CompanyModule } from './modules/company/company.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ColorsModule,
    SizesModule,
    BrandsModule,
    CategoriesModule,
    CashRegisterModule,
    BranchesModule,
    ClientsModule,
    DashboardModule,
    ProductsModule,
    SalesModule,
    QuotationsModule,
    PaymentMethodsModule,
    CompanyModule,
    SunatConfigModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
