import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SunatEmissionModule } from '../sunat-emission/sunat-emission.module';
import { GuiaRemisionCatalogosController } from './guia-remision-catalogos.controller';
import { GuiaRemisionCatalogosService } from './guia-remision-catalogos.service';
import { GuiaRemisionController } from './guia-remision.controller';
import { GuiaRemisionPdfService } from './guia-remision-pdf.service';
import { GuiaRemisionService } from './guia-remision.service';
import { GuiaScopeGuard } from './guards/guia-scope.guard';

@Module({
  imports: [PrismaModule, SunatEmissionModule],
  controllers: [GuiaRemisionController, GuiaRemisionCatalogosController],
  providers: [
    GuiaRemisionService,
    GuiaRemisionCatalogosService,
    GuiaRemisionPdfService,
    GuiaScopeGuard,
  ],
  exports: [GuiaRemisionService],
})
export class GuiaRemisionModule {}
