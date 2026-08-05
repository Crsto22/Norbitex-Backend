import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SunatEmissionModule } from '../sunat-emission/sunat-emission.module';
import { SalesModule } from '../sales/sales.module';
import { CreditNotePdfService } from './credit-note-pdf.service';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';
import { CreditNoteScopeGuard } from './guards/credit-note-scope.guard';

@Module({
  imports: [PrismaModule, StorageModule, SunatEmissionModule, SalesModule],
  controllers: [CreditNotesController],
  providers: [CreditNotesService, CreditNotePdfService, CreditNoteScopeGuard],
  exports: [CreditNotesService],
})
export class CreditNotesModule {}
