import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ClienteTipoDocumento,
  PlataformaComprobanteEstado,
  PlataformaComprobanteTipo,
  Prisma,
  SunatBajaEstado,
  SunatEndpointCodigo,
  SunatEstado,
  VentaTipoComprobante,
} from '@prisma/client';
import JSZip from 'jszip';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { SunatEndpointConfigService } from '../sunat-config/sunat-endpoint-config.service';
import { SunatCdrParserService } from '../sunat-emission/sunat-cdr-parser.service';
import { SunatBajaXmlBuilderService } from '../sunat-emission/sunat-baja-xml-builder.service';
import { SunatCreditNoteXmlBuilderService } from '../sunat-emission/sunat-credit-note-xml-builder.service';
import { SunatSoapClientService } from '../sunat-emission/sunat-soap-client.service';
import { SunatXmlBuilderService } from '../sunat-emission/sunat-xml-builder.service';
import { SunatXmlSignatureService } from '../sunat-emission/sunat-xml-signature.service';
import {
  sunatMetadataBody,
  sunatMetadataState,
} from '../sunat-emission/sunat-document-storage.service';
import {
  buildSunatBajaFileBase,
  sunatBajaFolder,
} from '../sunat-emission/sunat-comprobante.helper';
import { PlatformBillingService } from './platform-billing.service';
import { MailService } from '../mail/mail.service';

const emissionInclude = {
  detalles: true,
  comprobanteOrigen: true,
  empresa: { select: { email: true } },
} satisfies Prisma.ComprobantePlataformaInclude;

type EmissionReceipt = Prisma.ComprobantePlataformaGetPayload<{
  include: typeof emissionInclude;
}>;

@Injectable()
export class PlatformBillingSunatService {
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsCryptoService,
    private readonly storage: R2StorageService,
    private readonly endpointConfig: SunatEndpointConfigService,
    private readonly invoiceBuilder: SunatXmlBuilderService,
    private readonly creditBuilder: SunatCreditNoteXmlBuilderService,
    private readonly bajaBuilder: SunatBajaXmlBuilderService,
    private readonly signature: SunatXmlSignatureService,
    private readonly soap: SunatSoapClientService,
    private readonly cdrParser: SunatCdrParserService,
    private readonly billing: PlatformBillingService,
    private readonly mail: MailService,
  ) {}

  @Cron('*/15 * * * * *')
  async processPending() {
    if (this.running) return;
    this.running = true;
    try {
      const job = await this.prisma.comprobantePlataformaSunatJob.findFirst({
        where: {
          estado: 'pendiente',
          OR: [
            { siguienteIntentoAt: null },
            { siguienteIntentoAt: { lte: new Date() } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!job) return;
      const claimed =
        await this.prisma.comprobantePlataformaSunatJob.updateMany({
          where: { id: job.id, estado: 'pendiente' },
          data: { estado: 'procesando', intentos: { increment: 1 } },
        });
      if (claimed.count) {
        if (job.operacion === 'baja')
          await this.processCancellation(job.comprobanteId);
        else await this.emit(job.comprobanteId);
      }
    } finally {
      this.running = false;
    }
  }

  private async emit(id: bigint) {
    try {
      const [receipt, config] = await Promise.all([
        this.prisma.comprobantePlataforma.findUnique({
          where: { id },
          include: emissionInclude,
        }),
        this.prisma.configuracionFacturacionPlataforma.findUnique({
          where: { id: 1 },
        }),
      ]);
      if (
        !receipt ||
        !config?.activo ||
        !config.ruc ||
        !config.razonSocial ||
        !config.ubigeo ||
        !config.usuarioSolEncrypted ||
        !config.claveSolEncrypted ||
        !config.certificadoR2Key ||
        !config.certificadoPasswordEncrypted
      ) {
        throw new Error('La configuracion fiscal de Norbitex esta incompleta');
      }
      const endpoint = await this.endpointConfig.resolveEndpointUrl(
        config.ambiente,
        SunatEndpointCodigo.BILL_SERVICE,
      );
      if (!endpoint)
        throw new Error(
          'No existe endpoint SUNAT activo para el ambiente configurado',
        );

      const xml =
        receipt.tipo === PlataformaComprobanteTipo.nota_credito
          ? this.creditBuilder.build(
              this.creditAdapter(receipt, config) as never,
            )
          : this.invoiceBuilder.build(
              this.invoiceAdapter(receipt, config) as never,
            );
      const signed = await this.signature.sign({
        xml,
        certificadoR2Key: config.certificadoR2Key,
        certificadoPasswordEncrypted: config.certificadoPasswordEncrypted,
      });
      const base = this.fileBase(config.ruc, receipt);
      const xmlName = `${base}.xml`;
      const zipName = `${base}.zip`;
      const zip = new JSZip();
      zip.file(xmlName, signed.bytes);
      const zipBytes = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
      });
      const xmlStored = await this.storage.uploadPlatformSunatDocument({
        ambiente: config.ambiente,
        tipo: this.folder(receipt.tipo),
        fecha: receipt.fechaEmision,
        fileName: xmlName,
        body: signed.bytes,
        contentType: 'application/xml',
      });
      const sentAt = new Date();
      const metadata = {
        ambiente: config.ambiente,
        tipoDoc: this.typeCode(receipt.tipo),
        serie: receipt.serie,
        correlativo: receipt.numero.toString().padStart(8, '0'),
        ticket: null,
        estado: 'PENDIENTE' as const,
        fechaEmision: receipt.fechaEmision.toISOString().slice(0, 10),
        fechaEnvio: sentAt.toISOString(),
        fechaProcesado: null,
      };
      await this.storage.uploadPlatformSunatDocument({
        ambiente: config.ambiente,
        tipo: this.folder(receipt.tipo),
        fecha: receipt.fechaEmision,
        fileName: `${base}.metadata.json`,
        body: sunatMetadataBody(metadata),
        contentType: 'application/json',
      });
      const response = await this.soap.sendBill({
        endpoint,
        username: this.solUsername(
          config.ruc,
          this.secrets.decrypt(config.usuarioSolEncrypted),
        ),
        password: this.secrets.decrypt(config.claveSolEncrypted),
        zipFileName: zipName,
        zipBytes,
      });
      const cdr = await this.cdrParser.parse(response.cdrZipBytes);
      const cdrStored = await this.storage.uploadPlatformSunatDocument({
        ambiente: config.ambiente,
        tipo: this.folder(receipt.tipo),
        fecha: receipt.fechaEmision,
        fileName: response.cdrZipFileName,
        body: response.cdrZipBytes,
        contentType: 'application/zip',
      });
      const processedAt = new Date();
      await this.storage.uploadPlatformSunatDocument({
        ambiente: config.ambiente,
        tipo: this.folder(receipt.tipo),
        fecha: receipt.fechaEmision,
        fileName: `${base}.metadata.json`,
        body: sunatMetadataBody({
          ...metadata,
          estado: sunatMetadataState(cdr.estado),
          fechaProcesado: processedAt.toISOString(),
        }),
        contentType: 'application/json',
      });
      const accepted =
        cdr.estado === SunatEstado.aceptado ||
        cdr.estado === SunatEstado.observado;
      if (accepted && receipt.tipo === PlataformaComprobanteTipo.nota_credito)
        await this.billing.finalizeAcceptedCreditNote(receipt.id);
      await this.prisma.$transaction([
        this.prisma.comprobantePlataforma.update({
          where: { id: receipt.id },
          data: {
            estado: accepted
              ? PlataformaComprobanteEstado.aceptado
              : PlataformaComprobanteEstado.rechazado,
            sunatCodigo: cdr.codigo,
            sunatMensaje: cdr.mensaje,
            xmlR2Key: xmlStored.r2Key,
            cdrR2Key: cdrStored.r2Key,
          },
        }),
        this.prisma.comprobantePlataformaSunatJob.update({
          where: { comprobanteId: receipt.id },
          data: {
            estado: 'finalizado',
            ultimoError: null,
            siguienteIntentoAt: null,
          },
        }),
      ]);
      if (accepted && receipt.empresa.email)
        this.mail.sendPlatformReceipt(
          receipt.empresa.email,
          `${receipt.serie}-${String(receipt.numero).padStart(8, '0')}`,
        );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudo enviar el comprobante a SUNAT';
      const job = await this.prisma.comprobantePlataformaSunatJob.findUnique({
        where: { comprobanteId: id },
      });
      const retry = (job?.intentos ?? 1) < 5;
      await this.prisma.$transaction([
        this.prisma.comprobantePlataforma.update({
          where: { id },
          data: {
            estado: PlataformaComprobanteEstado.error,
            sunatCodigo: 'ENVIO',
            sunatMensaje: message.slice(0, 500),
          },
        }),
        this.prisma.comprobantePlataformaSunatJob.update({
          where: { comprobanteId: id },
          data: {
            estado: retry ? 'pendiente' : 'error',
            ultimoError: message.slice(0, 1000),
            siguienteIntentoAt: retry ? new Date(Date.now() + 60_000) : null,
          },
        }),
      ]);
    }
  }

  private async processCancellation(id: bigint) {
    try {
      const [receipt, config] = await Promise.all([
        this.prisma.comprobantePlataforma.findUnique({
          where: { id },
          include: emissionInclude,
        }),
        this.prisma.configuracionFacturacionPlataforma.findUnique({
          where: { id: 1 },
        }),
      ]);
      if (
        !receipt ||
        !receipt.sunatBajaTipo ||
        !receipt.sunatBajaCorrelativo ||
        !receipt.sunatBajaSolicitadaAt ||
        !config?.activo ||
        !config.ruc ||
        !config.razonSocial ||
        !config.usuarioSolEncrypted ||
        !config.claveSolEncrypted ||
        !config.certificadoR2Key ||
        !config.certificadoPasswordEncrypted
      ) {
        throw new Error(
          'La solicitud de baja o configuracion fiscal esta incompleta',
        );
      }
      const endpoint = await this.endpointConfig.resolveEndpointUrl(
        config.ambiente,
        SunatEndpointCodigo.BILL_SERVICE,
      );
      if (!endpoint)
        throw new Error(
          'No existe endpoint SUNAT activo para el ambiente configurado',
        );
      const credentials = {
        endpoint,
        username: this.solUsername(
          config.ruc,
          this.secrets.decrypt(config.usuarioSolEncrypted),
        ),
        password: this.secrets.decrypt(config.claveSolEncrypted),
      };

      if (!receipt.sunatBajaTicket) {
        const xml = this.bajaBuilder.build(
          this.cancellationAdapter(receipt, config) as never,
        );
        const signed = await this.signature.sign({
          xml,
          certificadoR2Key: config.certificadoR2Key,
          certificadoPasswordEncrypted: config.certificadoPasswordEncrypted,
        });
        const base = buildSunatBajaFileBase({
          ruc: config.ruc,
          tipo: receipt.sunatBajaTipo,
          fechaGeneracion: receipt.sunatBajaSolicitadaAt,
          correlativo: receipt.sunatBajaCorrelativo,
        });
        const xmlName = `${base}.xml`;
        const zipName = `${base}.zip`;
        const zip = new JSZip();
        zip.file(xmlName, signed.bytes);
        const zipBytes = await zip.generateAsync({
          type: 'nodebuffer',
          compression: 'DEFLATE',
        });
        const xmlStored = await this.storage.uploadPlatformSunatDocument({
          ambiente: config.ambiente,
          tipo: sunatBajaFolder(receipt.sunatBajaTipo),
          fecha: receipt.sunatBajaSolicitadaAt,
          fileName: xmlName,
          body: signed.bytes,
          contentType: 'application/xml',
        });
        const sentAt = new Date();
        const pendingMetadata = {
          ambiente: config.ambiente,
          tipoDoc: receipt.sunatBajaTipo,
          serie: receipt.sunatBajaTipo,
          correlativo: receipt.sunatBajaCorrelativo.toString().padStart(3, '0'),
          ticket: null,
          estado: 'PENDIENTE' as const,
          fechaEmision: receipt.sunatBajaSolicitadaAt
            .toISOString()
            .slice(0, 10),
          fechaEnvio: sentAt.toISOString(),
          fechaProcesado: null,
        };
        await this.storage.uploadPlatformSunatDocument({
          ambiente: config.ambiente,
          tipo: sunatBajaFolder(receipt.sunatBajaTipo),
          fecha: receipt.sunatBajaSolicitadaAt,
          fileName: `${base}.metadata.json`,
          body: sunatMetadataBody(pendingMetadata),
          contentType: 'application/json',
        });
        const response = await this.soap.sendSummary({
          ...credentials,
          zipFileName: zipName,
          zipBytes,
        });
        await this.storage.uploadPlatformSunatDocument({
          ambiente: config.ambiente,
          tipo: sunatBajaFolder(receipt.sunatBajaTipo),
          fecha: receipt.sunatBajaSolicitadaAt,
          fileName: `${base}.metadata.json`,
          body: sunatMetadataBody({
            ...pendingMetadata,
            ticket: response.ticket,
          }),
          contentType: 'application/json',
        });
        await this.prisma.$transaction([
          this.prisma.comprobantePlataforma.update({
            where: { id },
            data: {
              sunatBajaEstado: SunatBajaEstado.pendiente_cdr,
              sunatBajaCodigo: response.ticket,
              sunatBajaMensaje:
                'Baja enviada a SUNAT. Ticket pendiente de procesamiento.',
              sunatBajaTicket: response.ticket,
              sunatBajaXmlR2Key: xmlStored.r2Key,
            },
          }),
          this.prisma.comprobantePlataformaSunatJob.update({
            where: { comprobanteId: id },
            data: {
              estado: 'pendiente',
              intentos: 0,
              siguienteIntentoAt: new Date(Date.now() + 30_000),
              ultimoError: null,
            },
          }),
        ]);
        return;
      }

      const status = await this.soap.getStatus({
        ...credentials,
        ticket: receipt.sunatBajaTicket,
      });
      if (!status.cdrZipBytes) {
        await this.prisma.$transaction([
          this.prisma.comprobantePlataforma.update({
            where: { id },
            data: {
              sunatBajaEstado: SunatBajaEstado.pendiente_cdr,
              sunatBajaCodigo: status.statusCode ?? receipt.sunatBajaTicket,
              sunatBajaMensaje: 'SUNAT aun no devuelve CDR para la baja.',
              sunatBajaRespondidaAt: new Date(),
            },
          }),
          this.prisma.comprobantePlataformaSunatJob.update({
            where: { comprobanteId: id },
            data: {
              estado: 'pendiente',
              siguienteIntentoAt: new Date(Date.now() + 60_000),
              ultimoError: null,
            },
          }),
        ]);
        return;
      }

      const cdr = await this.cdrParser.parse(status.cdrZipBytes);
      const accepted =
        cdr.estado === SunatEstado.aceptado ||
        cdr.estado === SunatEstado.observado;
      const cdrStored = await this.storage.uploadPlatformSunatDocument({
        ambiente: config.ambiente,
        tipo: sunatBajaFolder(receipt.sunatBajaTipo),
        fecha: receipt.sunatBajaSolicitadaAt,
        fileName: `R-${buildSunatBajaFileBase({
          ruc: config.ruc,
          tipo: receipt.sunatBajaTipo,
          fechaGeneracion: receipt.sunatBajaSolicitadaAt,
          correlativo: receipt.sunatBajaCorrelativo,
        })}.zip`,
        body: status.cdrZipBytes,
        contentType: 'application/zip',
      });
      const processedAt = new Date();
      const cancellationBase = buildSunatBajaFileBase({
        ruc: config.ruc,
        tipo: receipt.sunatBajaTipo,
        fechaGeneracion: receipt.sunatBajaSolicitadaAt,
        correlativo: receipt.sunatBajaCorrelativo,
      });
      await this.storage.uploadPlatformSunatDocument({
        ambiente: config.ambiente,
        tipo: sunatBajaFolder(receipt.sunatBajaTipo),
        fecha: receipt.sunatBajaSolicitadaAt,
        fileName: `${cancellationBase}.metadata.json`,
        body: sunatMetadataBody({
          ambiente: config.ambiente,
          tipoDoc: receipt.sunatBajaTipo,
          serie: receipt.sunatBajaTipo,
          correlativo: receipt.sunatBajaCorrelativo.toString().padStart(3, '0'),
          ticket: receipt.sunatBajaTicket,
          estado: sunatMetadataState(cdr.estado),
          fechaEmision: receipt.sunatBajaSolicitadaAt
            .toISOString()
            .slice(0, 10),
          fechaEnvio: receipt.sunatBajaSolicitadaAt.toISOString(),
          fechaProcesado: processedAt.toISOString(),
        }),
        contentType: 'application/json',
      });
      if (accepted) await this.billing.finalizeAcceptedCancellation(id);
      await this.prisma.$transaction([
        this.prisma.comprobantePlataforma.update({
          where: { id },
          data: {
            estado: accepted
              ? PlataformaComprobanteEstado.anulado
              : PlataformaComprobanteEstado.aceptado,
            sunatBajaEstado: this.cancellationState(cdr.estado),
            sunatBajaCodigo: cdr.codigo,
            sunatBajaMensaje: cdr.mensaje,
            sunatBajaCdrR2Key: cdrStored.r2Key,
            sunatBajaRespondidaAt: new Date(),
          },
        }),
        this.prisma.comprobantePlataformaSunatJob.update({
          where: { comprobanteId: id },
          data: {
            estado: 'finalizado',
            siguienteIntentoAt: null,
            ultimoError: null,
          },
        }),
      ]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudo procesar la baja SUNAT';
      const job = await this.prisma.comprobantePlataformaSunatJob.findUnique({
        where: { comprobanteId: id },
      });
      const retry = (job?.intentos ?? 1) < 10;
      await this.prisma.$transaction([
        this.prisma.comprobantePlataforma.update({
          where: { id },
          data: {
            estado: retry
              ? PlataformaComprobanteEstado.anulacion_pendiente
              : PlataformaComprobanteEstado.aceptado,
            sunatBajaEstado: retry
              ? SunatBajaEstado.error_transitorio
              : SunatBajaEstado.error_definitivo,
            sunatBajaCodigo: 'ENVIO',
            sunatBajaMensaje: message.slice(0, 500),
            sunatBajaRespondidaAt: new Date(),
          },
        }),
        this.prisma.comprobantePlataformaSunatJob.update({
          where: { comprobanteId: id },
          data: {
            estado: retry ? 'pendiente' : 'error',
            siguienteIntentoAt: retry ? new Date(Date.now() + 60_000) : null,
            ultimoError: message.slice(0, 1000),
          },
        }),
      ]);
    }
  }

  private cancellationAdapter(
    receipt: EmissionReceipt,
    config: NonNullable<
      Awaited<
        ReturnType<
          PrismaService['configuracionFacturacionPlataforma']['findUnique']
        >
      >
    >,
  ) {
    const tipoComprobante =
      receipt.tipo === PlataformaComprobanteTipo.factura
        ? VentaTipoComprobante.factura
        : VentaTipoComprobante.boleta;
    return {
      tipoEnvio: receipt.sunatBajaTipo,
      fechaDocumento: receipt.fechaEmision,
      fechaGeneracion: receipt.sunatBajaSolicitadaAt,
      correlativo: receipt.sunatBajaCorrelativo,
      empresa: {
        ruc: config.ruc,
        razonSocial: config.razonSocial,
        nombreComercial: config.nombreComercial,
      },
      items: [
        {
          tipoComprobante,
          serie: receipt.serie,
          numero: receipt.numero,
          motivo: receipt.sunatBajaMotivo,
          venta: {
            total: receipt.total,
            moneda: receipt.moneda,
            opGravadas: receipt.baseImponible,
            igvMonto: receipt.igv,
            igvPorcentaje: config.igvPorcentaje,
          },
        },
      ],
    };
  }

  private cancellationState(state: SunatEstado) {
    return {
      [SunatEstado.aceptado]: SunatBajaEstado.aceptado,
      [SunatEstado.observado]: SunatBajaEstado.observado,
      [SunatEstado.rechazado]: SunatBajaEstado.rechazado,
      [SunatEstado.error_definitivo]: SunatBajaEstado.error_definitivo,
      [SunatEstado.error_transitorio]: SunatBajaEstado.error_transitorio,
      [SunatEstado.pendiente_envio]: SunatBajaEstado.pendiente_envio,
      [SunatEstado.enviando]: SunatBajaEstado.enviando,
      [SunatEstado.pendiente_cdr]: SunatBajaEstado.pendiente_cdr,
      [SunatEstado.no_aplica]: SunatBajaEstado.no_aplica,
    }[state];
  }

  private invoiceAdapter(
    receipt: EmissionReceipt,
    config: NonNullable<
      Awaited<
        ReturnType<
          PrismaService['configuracionFacturacionPlataforma']['findUnique']
        >
      >
    >,
  ) {
    return {
      serie: receipt.serie,
      numero: receipt.numero,
      createdAt: receipt.fechaEmision,
      moneda: receipt.moneda,
      tipoComprobante:
        receipt.tipo === PlataformaComprobanteTipo.factura
          ? VentaTipoComprobante.factura
          : VentaTipoComprobante.boleta,
      formaPago: 'CONTADO',
      total: receipt.total,
      igvPorcentaje: config.igvPorcentaje,
      opGravadas: receipt.baseImponible,
      opExoneradas: new Prisma.Decimal(0),
      opInafectas: new Prisma.Decimal(0),
      igvMonto: receipt.igv,
      empresa: {
        ruc: config.ruc,
        razonSocial: config.razonSocial,
        nombreComercial: config.nombreComercial,
        direccion: config.direccion,
      },
      sucursal: {
        ubigeo: config.ubigeo,
        codigoEstablecimientoSunat: '0000',
        distrito: '-',
        direccion: config.direccion,
      },
      cliente: {
        tipoDocumento: this.customerType(receipt.receptorTipoDocumento),
        numeroDocumento: receipt.receptorDocumento,
        razonSocial: receipt.receptorNombre,
        nombre: receipt.receptorNombre,
      },
      detalles: this.details(receipt),
    };
  }

  private creditAdapter(
    receipt: EmissionReceipt,
    config: NonNullable<
      Awaited<
        ReturnType<
          PrismaService['configuracionFacturacionPlataforma']['findUnique']
        >
      >
    >,
  ) {
    const origin = receipt.comprobanteOrigen!;
    return {
      ...this.invoiceAdapter(receipt, config),
      serieRef: origin.serie,
      numeroRef: origin.numero,
      tipoDocumentoRef:
        origin.tipo === PlataformaComprobanteTipo.factura
          ? VentaTipoComprobante.factura
          : VentaTipoComprobante.boleta,
      codigoMotivo: '01',
      descripcionMotivo:
        receipt.motivoNotaCredito ?? 'Anulacion de la operacion',
    };
  }

  private details(receipt: EmissionReceipt) {
    return receipt.detalles.map((line) => {
      const listTotal = line.precioUnitario.mul(line.cantidad);
      const listBase = line.total.gt(0)
        ? line.baseImponible.mul(listTotal).div(line.total).toDecimalPlaces(2)
        : line.baseImponible;
      return {
        cantidad: line.cantidad.toNumber(),
        descripcion: line.descripcion,
        precioUnitario: line.precioUnitario,
        valorUnitario: listBase.div(line.cantidad),
        valorVenta: line.baseImponible,
        total: line.total,
        igvMonto: line.igv,
        unidadMedidaCodigo: 'ZZ',
        tipoAfectacionIgvCodigo: '10',
        productoVariante: { sku: null, producto: { nombre: line.descripcion } },
      };
    });
  }

  private customerType(code: string | null) {
    return code === '6'
      ? ClienteTipoDocumento.ruc
      : code === '1'
        ? ClienteTipoDocumento.dni
        : ClienteTipoDocumento.sin_documento;
  }
  private solUsername(ruc: string, user: string) {
    return user.startsWith(ruc) ? user : `${ruc}${user}`;
  }
  private folder(type: PlataformaComprobanteTipo) {
    return type === PlataformaComprobanteTipo.factura
      ? ('facturas' as const)
      : type === PlataformaComprobanteTipo.boleta
        ? ('boletas' as const)
        : ('notas-credito' as const);
  }
  private fileBase(ruc: string, receipt: EmissionReceipt) {
    return `${ruc}-${this.typeCode(receipt.tipo)}-${receipt.serie}-${String(receipt.numero).padStart(8, '0')}`;
  }

  private typeCode(type: PlataformaComprobanteTipo) {
    return type === PlataformaComprobanteTipo.factura
      ? '01'
      : type === PlataformaComprobanteTipo.boleta
        ? '03'
        : '07';
  }
}
