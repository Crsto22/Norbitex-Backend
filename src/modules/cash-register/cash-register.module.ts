import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { CashRegisterPdfService } from './cash-register-pdf.service';
import { CashRegisterController } from './cash-register.controller';
import { CashRegisterService } from './cash-register.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [CashRegisterController],
  providers: [CashRegisterService, CashRegisterPdfService],
  exports: [CashRegisterService],
})
export class CashRegisterModule {}
