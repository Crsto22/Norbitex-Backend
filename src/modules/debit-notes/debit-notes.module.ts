import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingIntegrationModule } from '../billing-integration/billing-integration.module';
import { DebitNotesController } from './debit-notes.controller';
import { DebitNotesService } from './debit-notes.service';

@Module({
  imports: [PrismaModule, BillingIntegrationModule],
  controllers: [DebitNotesController],
  providers: [DebitNotesService],
  exports: [DebitNotesService],
})
export class DebitNotesModule {}
