import { Injectable } from '@nestjs/common';
import {
  SunatAmbiente,
  SunatBajaTipo,
  SunatEstado,
  VentaTipoComprobante,
} from '@prisma/client';
import { R2StorageService } from '../storage/r2-storage.service';
import { sunatBajaFolder, sunatFolder } from './sunat-comprobante.helper';

@Injectable()
export class SunatDocumentStorageService {
  constructor(private readonly r2StorageService: R2StorageService) {}

  storeSaleDocument(params: {
    empresaId: bigint;
    ambiente: SunatAmbiente;
    tipoComprobante: VentaTipoComprobante;
    fecha: Date;
    fileName: string;
    body: Buffer;
    contentType: string;
  }) {
    return this.r2StorageService.uploadSunatDocument({
      empresaId: params.empresaId,
      ambiente: params.ambiente,
      tipo: sunatFolder(params.tipoComprobante),
      fecha: params.fecha,
      fileName: params.fileName,
      body: params.body,
      contentType: params.contentType,
    });
  }

  storeSaleMetadata(params: {
    empresaId: bigint;
    ambiente: SunatAmbiente;
    tipoComprobante: VentaTipoComprobante;
    fecha: Date;
    fileBase: string;
    metadata: SunatDocumentMetadata;
  }) {
    return this.storeSaleDocument({
      ...params,
      fileName: `${params.fileBase}.metadata.json`,
      body: sunatMetadataBody(params.metadata),
      contentType: 'application/json',
    });
  }

  storeBajaDocument(params: {
    empresaId: bigint;
    ambiente: SunatAmbiente;
    tipo: SunatBajaTipo;
    fecha: Date;
    fileName: string;
    body: Buffer;
    contentType: string;
  }) {
    return this.r2StorageService.uploadSunatDocument({
      empresaId: params.empresaId,
      ambiente: params.ambiente,
      tipo: sunatBajaFolder(params.tipo),
      fecha: params.fecha,
      fileName: params.fileName,
      body: params.body,
      contentType: params.contentType,
    });
  }

  storeBajaMetadata(params: {
    empresaId: bigint;
    ambiente: SunatAmbiente;
    tipo: SunatBajaTipo;
    fecha: Date;
    fileBase: string;
    metadata: SunatDocumentMetadata;
  }) {
    return this.storeBajaDocument({
      ...params,
      fileName: `${params.fileBase}.metadata.json`,
      body: sunatMetadataBody(params.metadata),
      contentType: 'application/json',
    });
  }

  storeGuiaDocument(params: {
    empresaId: bigint;
    ambiente: SunatAmbiente;
    fecha: Date;
    fileName: string;
    body: Buffer;
    contentType: string;
  }) {
    return this.r2StorageService.uploadSunatDocument({
      empresaId: params.empresaId,
      ambiente: params.ambiente,
      tipo: 'guias-remision',
      fecha: params.fecha,
      fileName: params.fileName,
      body: params.body,
      contentType: params.contentType,
    });
  }

  storeGuiaMetadata(params: {
    empresaId: bigint;
    ambiente: SunatAmbiente;
    fecha: Date;
    fileBase: string;
    metadata: SunatDocumentMetadata;
  }) {
    return this.storeGuiaDocument({
      ...params,
      fileName: `${params.fileBase}.metadata.json`,
      body: sunatMetadataBody(params.metadata),
      contentType: 'application/json',
    });
  }

  signedDownloadUrl(key: string, fileName?: string) {
    return this.r2StorageService.getSignedSunatDocumentUrl(key, fileName);
  }
}

export type SunatDocumentMetadata = {
  ambiente: SunatAmbiente;
  tipoDoc: string;
  serie: string;
  correlativo: string;
  ticket: string | null;
  estado: 'PENDIENTE' | 'ACEPTADA' | 'OBSERVADA' | 'RECHAZADA';
  fechaEmision: string;
  fechaEnvio: string;
  fechaProcesado: string | null;
};

export function sunatMetadataBody(metadata: SunatDocumentMetadata) {
  return Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

export function sunatMetadataState(estado: SunatEstado) {
  if (estado === SunatEstado.aceptado) return 'ACEPTADA' as const;
  if (estado === SunatEstado.observado) return 'OBSERVADA' as const;
  return 'RECHAZADA' as const;
}
