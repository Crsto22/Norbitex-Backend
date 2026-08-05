import { Module } from '@nestjs/common';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SunatConfigModule } from '../sunat-config/sunat-config.module';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import { SunatBajaService } from './sunat-baja.service';
import { SunatBajaXmlBuilderService } from './sunat-baja-xml-builder.service';
import { SunatCreditNoteEmissionService } from './sunat-credit-note-emission.service';
import { SunatCreditNoteXmlBuilderService } from './sunat-credit-note-xml-builder.service';
import { SunatDocumentStorageService } from './sunat-document-storage.service';
import { SunatEmissionService } from './sunat-emission.service';
import { SunatGuiaRemisionService } from './sunat-guia-remision.service';
import { SunatGuiaRemisionXmlBuilderService } from './sunat-guia-remision-xml-builder.service';
import { SunatJobRunnerService } from './sunat-job-runner.service';
import { SunatJobService } from './sunat-job.service';
import { SunatSoapClientService } from './sunat-soap-client.service';
import { SunatTaxService } from './sunat-tax.service';
import { SunatXmlBuilderService } from './sunat-xml-builder.service';
import { SunatXmlSignatureService } from './sunat-xml-signature.service';
import { SunatRestApiClientService } from './sunat-rest-api-client.service';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [PrismaModule, StorageModule, SunatConfigModule, StockModule],
  providers: [
    SecretsCryptoService,
    SunatTaxService,
    SunatJobService,
    SunatJobRunnerService,
    SunatEmissionService,
    SunatCreditNoteEmissionService,
    SunatGuiaRemisionService,
    SunatGuiaRemisionXmlBuilderService,
    SunatRestApiClientService,
    SunatBajaService,
    SunatXmlBuilderService,
    SunatCreditNoteXmlBuilderService,
    SunatBajaXmlBuilderService,
    SunatXmlSignatureService,
    SunatSoapClientService,
    SunatCdrParserService,
    SunatDocumentStorageService,
  ],
  exports: [
    SunatTaxService,
    SunatJobService,
    SunatEmissionService,
    SunatCreditNoteEmissionService,
    SunatBajaService,
    SunatGuiaRemisionService,
    SunatGuiaRemisionXmlBuilderService,
    SunatDocumentStorageService,
    SunatXmlBuilderService,
    SunatCreditNoteXmlBuilderService,
    SunatBajaXmlBuilderService,
    SunatXmlSignatureService,
    SunatSoapClientService,
    SunatCdrParserService,
  ],
})
export class SunatEmissionModule {}
