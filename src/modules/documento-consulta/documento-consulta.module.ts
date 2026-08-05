import { Module } from '@nestjs/common';
import { DocumentoConsultaController } from './documento-consulta.controller';
import { DocumentoConsultaService } from './documento-consulta.service';

@Module({
  controllers: [DocumentoConsultaController],
  providers: [DocumentoConsultaService],
})
export class DocumentoConsultaModule {}
