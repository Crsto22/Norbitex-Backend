import { createHash } from 'node:crypto';
import {
  ClienteTipoDocumento,
  SunatBajaTipo,
  VentaTipoComprobante,
} from '@prisma/client';

export function isElectronicSaleType(tipo: VentaTipoComprobante) {
  return (
    tipo === VentaTipoComprobante.factura ||
    tipo === VentaTipoComprobante.boleta
  );
}

export function sunatDocumentCode(tipo: VentaTipoComprobante) {
  if (tipo === VentaTipoComprobante.factura) {
    return '01';
  }

  if (tipo === VentaTipoComprobante.boleta) {
    return '03';
  }

  return '00';
}

export function isCreditNoteType(tipo: VentaTipoComprobante) {
  return (
    tipo === VentaTipoComprobante.nota_credito_factura ||
    tipo === VentaTipoComprobante.nota_credito_boleta
  );
}

export function sunatCustomerDocumentCode(tipo?: ClienteTipoDocumento | null) {
  if (tipo === ClienteTipoDocumento.dni) {
    return '1';
  }

  if (tipo === ClienteTipoDocumento.ruc) {
    return '6';
  }

  return '0';
}

export function sunatFolder(tipo: VentaTipoComprobante) {
  if (isCreditNoteType(tipo)) {
    return 'notas-credito';
  }

  return tipo === VentaTipoComprobante.factura ? 'facturas' : 'boletas';
}

export function sunatBajaFolder(tipo: SunatBajaTipo) {
  return tipo === SunatBajaTipo.RA ? 'bajas-ra' : 'bajas-rc';
}

export function formatSunatNumber(serie: string, numero: number) {
  return `${serie}-${numero.toString().padStart(8, '0')}`;
}

export function buildSunatFileBase(params: {
  ruc: string;
  tipoComprobante: VentaTipoComprobante;
  serie: string;
  numero: number;
}) {
  return [
    params.ruc,
    isCreditNoteType(params.tipoComprobante)
      ? '07'
      : sunatDocumentCode(params.tipoComprobante),
    formatSunatNumber(params.serie, params.numero),
  ].join('-');
}

export function formatSunatBajaNumber(params: {
  tipo: SunatBajaTipo;
  fechaGeneracion: Date;
  correlativo: number;
}) {
  const ymd = params.fechaGeneracion
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
  return `${params.tipo}-${ymd}-${params.correlativo.toString().padStart(3, '0')}`;
}

export function buildSunatBajaFileBase(params: {
  ruc: string;
  tipo: SunatBajaTipo;
  fechaGeneracion: Date;
  correlativo: number;
}) {
  return [
    params.ruc,
    formatSunatBajaNumber({
      tipo: params.tipo,
      fechaGeneracion: params.fechaGeneracion,
      correlativo: params.correlativo,
    }),
  ].join('-');
}

export function buildQrContent(params: {
  ruc: string;
  tipoComprobante: VentaTipoComprobante;
  serie: string;
  numero: number;
  igv: string;
  total: string;
  fecha: Date;
  clienteTipoDocumento?: ClienteTipoDocumento | null;
  clienteNumeroDocumento?: string | null;
}) {
  return [
    params.ruc,
    isCreditNoteType(params.tipoComprobante)
      ? '07'
      : sunatDocumentCode(params.tipoComprobante),
    params.serie,
    String(params.numero),
    params.igv,
    params.total,
    params.fecha.toISOString().slice(0, 10),
    sunatCustomerDocumentCode(params.clienteTipoDocumento),
    params.clienteNumeroDocumento || '-',
  ].join('|');
}

export function sha256Base64(value: string | Buffer) {
  return createHash('sha256').update(value).digest('base64');
}
