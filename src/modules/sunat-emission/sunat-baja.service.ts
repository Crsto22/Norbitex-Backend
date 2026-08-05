import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CajaMovimientoTipo,
  CajaSesionEstado,
  Prisma,
  SunatBajaEstado,
  SunatBajaTipo,
  SunatEndpointCodigo,
  SunatEstado,
  SunatJobEstado,
  SunatJobTipoDocumento,
  VentaEstado,
  StockMovimientoTipo,
  VentaTipoComprobante,
} from '@prisma/client';
import { StockService } from '../stock/stock.service';
import JSZip from 'jszip';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SunatEndpointConfigService } from '../sunat-config/sunat-endpoint-config.service';
import {
  buildSunatBajaFileBase,
  isElectronicSaleType,
  sha256Base64,
} from './sunat-comprobante.helper';
import {
  sunatBajaInclude,
  SunatBajaLoteWithItems,
} from './sunat-baja-xml-builder.service';
import { SunatBajaXmlBuilderService } from './sunat-baja-xml-builder.service';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import { assertSunatEnvironmentAllowed } from '../plans/sunat-plan-access';
import {
  SunatDocumentStorageService,
  sunatMetadataState,
} from './sunat-document-storage.service';
import { SunatSoapClientService } from './sunat-soap-client.service';
import { SunatXmlSignatureService } from './sunat-xml-signature.service';

const blockingBajaStates: SunatBajaEstado[] = [
  SunatBajaEstado.pendiente_envio,
  SunatBajaEstado.enviando,
  SunatBajaEstado.pendiente_cdr,
  SunatBajaEstado.aceptado,
  SunatBajaEstado.observado,
];

@Injectable()
export class SunatBajaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretsCryptoService: SecretsCryptoService,
    private readonly endpointConfigService: SunatEndpointConfigService,
    private readonly xmlBuilderService: SunatBajaXmlBuilderService,
    private readonly xmlSignatureService: SunatXmlSignatureService,
    private readonly soapClientService: SunatSoapClientService,
    private readonly cdrParserService: SunatCdrParserService,
    private readonly documentStorageService: SunatDocumentStorageService,
    private readonly stockService: StockService,
  ) {}

  async solicitarBajaVenta(
    empresaId: bigint,
    publicId: string,
    motivo: string,
  ) {
    const normalizedMotivo = this.normalizeMotivo(motivo);
    const venta = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      include: {
        detalles: true,
      },
    });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }

    this.validateSaleForBaja(venta);

    const tipoEnvio = this.resolveTipoEnvio(venta.tipoComprobante);
    const now = new Date();
    const fechaDocumento = this.toDateOnly(venta.createdAt);
    const fechaGeneracion = this.toDateOnly(now);

    const result = await this.prisma.$transaction(async (tx) => {
      const lote = await this.obtenerOCrearLote(tx, {
        empresaId,
        tipoEnvio,
        fechaDocumento,
        fechaGeneracion,
      });

      await tx.sunatBajaItem.create({
        data: {
          loteId: lote.id,
          ventaId: venta.id,
          tipoComprobante: venta.tipoComprobante,
          serie: venta.serie,
          numero: venta.numero,
          fechaDocumento,
          motivo: normalizedMotivo,
        },
      });

      const updated = await tx.venta.update({
        where: { id: venta.id },
        data: {
          tipoAnulacion: 'SUNAT_BAJA',
          anuladoRazon: normalizedMotivo,
          sunatBajaEstado: SunatBajaEstado.pendiente_envio,
          sunatBajaCodigo: null,
          sunatBajaMensaje:
            'Solicitud de baja registrada. Pendiente de envio a SUNAT.',
          sunatBajaTicket: null,
          sunatBajaTipo: tipoEnvio,
          sunatBajaLoteId: lote.id,
          sunatBajaSolicitadaAt: now,
          sunatBajaRespondidaAt: null,
        },
        include: {
          sunatBajaLote: true,
        },
      });

      await tx.sunatJob.upsert({
        where: {
          tipoDocumento_documentoId: {
            tipoDocumento: SunatJobTipoDocumento.baja_lote,
            documentoId: lote.id,
          },
        },
        create: {
          empresaId,
          tipoDocumento: SunatJobTipoDocumento.baja_lote,
          documentoId: lote.id,
          estado: SunatJobEstado.pendiente_envio,
          nextRetryAt: new Date(),
        },
        update: {
          estado: SunatJobEstado.pendiente_envio,
          intentos: 0,
          ultimoCodigo: null,
          ultimoError: null,
          lockedAt: null,
          lastAttemptAt: null,
          processedAt: null,
          nextRetryAt: new Date(),
        },
      });

      return updated;
    });

    return this.toBajaResponse(result, result.sunatBajaLote);
  }

  async processLote(loteId: bigint) {
    const lote = await this.findLote(loteId);

    if (lote.estado === SunatBajaEstado.pendiente_cdr) {
      await this.consultarLote(lote);
      return;
    }

    await this.enviarLote(lote);
  }

  async consultarBajaVenta(empresaId: bigint, publicId: string) {
    const venta = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      include: { sunatBajaLote: true },
    });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }

    if (!venta.sunatBajaLoteId) {
      throw new BadRequestException('La venta no tiene baja SUNAT asociada');
    }

    const lote = await this.findLote(venta.sunatBajaLoteId);
    await this.consultarLote(lote);

    const updated = await this.prisma.venta.findUnique({
      where: { id: venta.id },
      include: { sunatBajaLote: true },
    });

    return this.toBajaResponse(
      updated ?? venta,
      updated?.sunatBajaLote ?? null,
    );
  }

  async downloadBajaArtifact(
    empresaId: bigint,
    publicId: string,
    artifact: 'xml' | 'cdr',
  ) {
    const venta = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      include: { sunatBajaLote: true },
    });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }

    const lote = venta.sunatBajaLote;
    if (!lote) {
      throw new BadRequestException('La venta no tiene baja SUNAT asociada');
    }

    const key = artifact === 'xml' ? lote.sunatXmlKey : lote.sunatCdrKey;
    const fileName =
      artifact === 'xml' ? lote.sunatXmlNombre : lote.sunatCdrNombre;

    if (!key || !fileName) {
      throw new NotFoundException('Archivo de baja SUNAT no disponible');
    }

    return {
      fileName,
      url: await this.documentStorageService.signedDownloadUrl(key, fileName),
    };
  }

  async marcarErrorDefinitivo(loteId: bigint, codigo: string, mensaje: string) {
    await this.applyLoteResult(loteId, {
      estado: SunatBajaEstado.error_definitivo,
      codigo,
      mensaje,
      ticket: null,
      hash: null,
      xmlNombre: null,
      xmlKey: null,
      zipNombre: null,
      zipKey: null,
      cdrNombre: null,
      cdrKey: null,
      enviadoAt: null,
      respondidoAt: new Date(),
    });
  }

  toPublicSunatBaja(venta: {
    sunatBajaEstado: SunatBajaEstado | null;
    sunatBajaCodigo: string | null;
    sunatBajaMensaje: string | null;
    sunatBajaTicket: string | null;
    sunatBajaTipo: SunatBajaTipo | null;
    sunatBajaSolicitadaAt: Date | null;
    sunatBajaRespondidaAt: Date | null;
    sunatBajaLote?: {
      tipoEnvio: SunatBajaTipo;
      fechaGeneracion: Date;
      correlativo: number;
      sunatXmlKey: string | null;
      sunatCdrKey: string | null;
    } | null;
  }) {
    const lote = venta.sunatBajaLote;
    return {
      estado: venta.sunatBajaEstado ?? SunatBajaEstado.no_aplica,
      codigo: venta.sunatBajaCodigo,
      mensaje: venta.sunatBajaMensaje,
      ticket: venta.sunatBajaTicket,
      tipo: venta.sunatBajaTipo,
      lote: lote
        ? this.loteNumber({
            tipoEnvio: lote.tipoEnvio,
            fechaGeneracion: lote.fechaGeneracion,
            correlativo: lote.correlativo,
          })
        : null,
      xmlDisponible: Boolean(lote?.sunatXmlKey),
      cdrDisponible: Boolean(lote?.sunatCdrKey),
      solicitadaAt: venta.sunatBajaSolicitadaAt?.toISOString() ?? null,
      respondidaAt: venta.sunatBajaRespondidaAt?.toISOString() ?? null,
    };
  }

  private async enviarLote(lote: SunatBajaLoteWithItems) {
    await this.updateLoteAndVentas(lote.id, {
      estado: SunatBajaEstado.enviando,
      codigo: null,
      mensaje: 'Procesando envio del lote de baja a SUNAT.',
    });

    try {
      const config = await this.resolveConfig(lote.empresaId);
      const fileBase = buildSunatBajaFileBase({
        ruc: lote.empresa.ruc!,
        tipo: lote.tipoEnvio,
        fechaGeneracion: lote.fechaGeneracion,
        correlativo: lote.correlativo,
      });
      const xmlName = `${fileBase}.xml`;
      const zipName = `${fileBase}.zip`;
      const xml = this.xmlBuilderService.build(lote);
      const signed = await this.xmlSignatureService.sign({
        xml,
        certificadoR2Key: config.certificadoR2Key,
        certificadoPasswordEncrypted: config.certificadoPasswordEncrypted,
      });
      const zipBytes = await this.zip(xmlName, signed.bytes);
      const xmlStored = await this.documentStorageService.storeBajaDocument({
        empresaId: lote.empresaId,
        ambiente: config.ambiente,
        tipo: lote.tipoEnvio,
        fecha: lote.fechaGeneracion,
        fileName: xmlName,
        body: signed.bytes,
        contentType: 'application/xml',
      });
      const zipStored = await this.documentStorageService.storeBajaDocument({
        empresaId: lote.empresaId,
        ambiente: config.ambiente,
        tipo: lote.tipoEnvio,
        fecha: lote.fechaGeneracion,
        fileName: zipName,
        body: zipBytes,
        contentType: 'application/zip',
      });
      const sentAt = new Date();
      const pendingMetadata = {
        ambiente: config.ambiente,
        tipoDoc: lote.tipoEnvio,
        serie: lote.tipoEnvio,
        correlativo: lote.correlativo.toString().padStart(3, '0'),
        ticket: null,
        estado: 'PENDIENTE' as const,
        fechaEmision: lote.fechaGeneracion.toISOString().slice(0, 10),
        fechaEnvio: sentAt.toISOString(),
        fechaProcesado: null,
      };
      await this.documentStorageService.storeBajaMetadata({
        empresaId: lote.empresaId,
        ambiente: config.ambiente,
        tipo: lote.tipoEnvio,
        fecha: lote.fechaGeneracion,
        fileBase,
        metadata: pendingMetadata,
      });
      const response = await this.soapClientService.sendSummary({
        endpoint: config.billEndpoint,
        username: config.username,
        password: config.password,
        zipFileName: zipName,
        zipBytes,
      });
      await this.documentStorageService.storeBajaMetadata({
        empresaId: lote.empresaId,
        ambiente: config.ambiente,
        tipo: lote.tipoEnvio,
        fecha: lote.fechaGeneracion,
        fileBase,
        metadata: { ...pendingMetadata, ticket: response.ticket },
      });

      await this.applyLoteResult(lote.id, {
        estado: SunatBajaEstado.pendiente_cdr,
        codigo: response.ticket,
        mensaje:
          'Lote de baja enviado a SUNAT. Ticket pendiente de procesamiento.',
        ticket: response.ticket,
        hash: signed.digestValue || sha256Base64(signed.bytes),
        xmlNombre: xmlStored.nombre,
        xmlKey: xmlStored.r2Key,
        zipNombre: zipStored.nombre,
        zipKey: zipStored.r2Key,
        cdrNombre: null,
        cdrKey: null,
        enviadoAt: sentAt,
        respondidoAt: new Date(),
      });
    } catch (error) {
      await this.applyLoteResult(lote.id, {
        estado: this.isDefinitiveError(error)
          ? SunatBajaEstado.error_definitivo
          : SunatBajaEstado.error_transitorio,
        codigo: this.isDefinitiveError(error) ? 'CONFIG' : 'ENVIO',
        mensaje: this.errorMessage(error),
        ticket: null,
        hash: null,
        xmlNombre: null,
        xmlKey: null,
        zipNombre: null,
        zipKey: null,
        cdrNombre: null,
        cdrKey: null,
        enviadoAt: null,
        respondidoAt: new Date(),
      });
    }
  }

  private async consultarLote(lote: SunatBajaLoteWithItems) {
    const ticket = lote.ticketSunat;
    if (!ticket) {
      throw new BadRequestException('El lote de baja no tiene ticket SUNAT');
    }

    try {
      const config = await this.resolveConfig(lote.empresaId);
      const status = await this.soapClientService.getStatus({
        endpoint: config.billEndpoint,
        username: config.username,
        password: config.password,
        ticket,
      });

      if (!status.cdrZipBytes) {
        await this.applyLoteResult(lote.id, {
          estado: SunatBajaEstado.pendiente_cdr,
          codigo: status.statusCode ?? ticket,
          mensaje: 'SUNAT aun no devuelve CDR para la baja.',
          ticket,
          hash: lote.sunatHash,
          xmlNombre: lote.sunatXmlNombre,
          xmlKey: lote.sunatXmlKey,
          zipNombre: lote.sunatZipNombre,
          zipKey: lote.sunatZipKey,
          cdrNombre: null,
          cdrKey: null,
          enviadoAt: lote.sunatEnviadoAt,
          respondidoAt: new Date(),
        });
        return;
      }

      const cdr = await this.cdrParserService.parse(status.cdrZipBytes);
      const cdrName = lote.sunatZipNombre
        ? `R-${lote.sunatZipNombre}`
        : status.cdrZipFileName;
      const cdrStored = await this.documentStorageService.storeBajaDocument({
        empresaId: lote.empresaId,
        ambiente: config.ambiente,
        tipo: lote.tipoEnvio,
        fecha: lote.fechaGeneracion,
        fileName: cdrName,
        body: status.cdrZipBytes,
        contentType: 'application/zip',
      });
      const processedAt = new Date();
      const fileBase = buildSunatBajaFileBase({
        ruc: lote.empresa.ruc!,
        tipo: lote.tipoEnvio,
        fechaGeneracion: lote.fechaGeneracion,
        correlativo: lote.correlativo,
      });
      await this.documentStorageService.storeBajaMetadata({
        empresaId: lote.empresaId,
        ambiente: config.ambiente,
        tipo: lote.tipoEnvio,
        fecha: lote.fechaGeneracion,
        fileBase,
        metadata: {
          ambiente: config.ambiente,
          tipoDoc: lote.tipoEnvio,
          serie: lote.tipoEnvio,
          correlativo: lote.correlativo.toString().padStart(3, '0'),
          ticket,
          estado: sunatMetadataState(cdr.estado),
          fechaEmision: lote.fechaGeneracion.toISOString().slice(0, 10),
          fechaEnvio: (lote.sunatEnviadoAt ?? processedAt).toISOString(),
          fechaProcesado: processedAt.toISOString(),
        },
      });

      await this.applyLoteResult(lote.id, {
        estado: this.mapSunatEstado(cdr.estado),
        codigo: cdr.codigo,
        mensaje: cdr.mensaje,
        ticket,
        hash: lote.sunatHash,
        xmlNombre: lote.sunatXmlNombre,
        xmlKey: lote.sunatXmlKey,
        zipNombre: lote.sunatZipNombre,
        zipKey: lote.sunatZipKey,
        cdrNombre: cdrStored.nombre,
        cdrKey: cdrStored.r2Key,
        enviadoAt: lote.sunatEnviadoAt,
        respondidoAt: processedAt,
      });
    } catch (error) {
      await this.applyLoteResult(lote.id, {
        estado: this.isDefinitiveError(error)
          ? SunatBajaEstado.error_definitivo
          : SunatBajaEstado.error_transitorio,
        codigo: this.isDefinitiveError(error) ? 'CONFIG' : 'CONSULTA',
        mensaje: this.errorMessage(error),
        ticket,
        hash: lote.sunatHash,
        xmlNombre: lote.sunatXmlNombre,
        xmlKey: lote.sunatXmlKey,
        zipNombre: lote.sunatZipNombre,
        zipKey: lote.sunatZipKey,
        cdrNombre: lote.sunatCdrNombre,
        cdrKey: lote.sunatCdrKey,
        enviadoAt: lote.sunatEnviadoAt,
        respondidoAt: new Date(),
      });
    }
  }

  private async applyLoteResult(
    loteId: bigint,
    result: {
      estado: SunatBajaEstado;
      codigo: string | null;
      mensaje: string | null;
      ticket: string | null;
      hash: string | null;
      xmlNombre: string | null;
      xmlKey: string | null;
      zipNombre: string | null;
      zipKey: string | null;
      cdrNombre: string | null;
      cdrKey: string | null;
      enviadoAt: Date | null;
      respondidoAt: Date | null;
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.sunatBajaLote.update({
        where: { id: loteId },
        data: {
          estado: result.estado,
          codigo: result.codigo,
          mensaje: result.mensaje,
          ticketSunat: result.ticket,
          sunatHash: result.hash ?? undefined,
          sunatXmlNombre: result.xmlNombre ?? undefined,
          sunatXmlKey: result.xmlKey ?? undefined,
          sunatZipNombre: result.zipNombre ?? undefined,
          sunatZipKey: result.zipKey ?? undefined,
          sunatCdrNombre: result.cdrNombre ?? undefined,
          sunatCdrKey: result.cdrKey ?? undefined,
          sunatEnviadoAt: result.enviadoAt ?? undefined,
          sunatRespondidoAt: result.respondidoAt ?? undefined,
        },
      });

      const ventas = await tx.venta.findMany({
        where: { sunatBajaLoteId: loteId },
        include: { pagos: true, detalles: true, cajaSesion: true },
      });

      for (const venta of ventas) {
        await tx.venta.update({
          where: { id: venta.id },
          data: {
            sunatBajaEstado: result.estado,
            sunatBajaCodigo: result.codigo,
            sunatBajaMensaje: result.mensaje,
            sunatBajaTicket: result.ticket,
            sunatBajaRespondidaAt: result.respondidoAt,
          },
        });

        if (
          result.estado === SunatBajaEstado.aceptado ||
          result.estado === SunatBajaEstado.observado
        ) {
          await this.finalizeLocalAnnul(tx, venta);
        }
      }
    });
  }

  private async finalizeLocalAnnul(
    tx: Prisma.TransactionClient,
    venta: Prisma.VentaGetPayload<{
      include: { pagos: true; detalles: true; cajaSesion: true };
    }>,
  ) {
    if (venta.estado === VentaEstado.anulada) {
      return;
    }

    if (venta.cajaSesion?.estado === CajaSesionEstado.abierta) {
      const activePayments = venta.pagos.filter((p) => p.estado === 'activo');
      if (activePayments.length > 0) {
        await tx.cajaMovimiento.createMany({
          data: activePayments.map((p) => ({
            empresaId: venta.empresaId,
            cajaSesionId: venta.cajaSesionId!,
            ventaId: venta.id,
            ventaPagoId: p.id,
            metodoPagoId: p.metodoPagoId,
            tipo: CajaMovimientoTipo.anulacion_venta,
            monto: p.monto.mul(-1),
            motivo: venta.anuladoRazon ?? 'Baja SUNAT aceptada',
            referencia: p.referencia,
          })),
        });
      }
    }

    if (venta.sucursalId) {
      for (const detalle of venta.detalles) {
        await this.stockService.changeStock(tx, {
          empresaId: venta.empresaId,
          sucursalId: venta.sucursalId,
          productoVarianteId: detalle.productoVarianteId,
          delta: detalle.cantidad,
          tipo: StockMovimientoTipo.anulacion_venta,
          motivo: venta.anuladoRazon ?? 'Baja SUNAT aceptada',
          creadoPorId: venta.creadoPorId,
          referenciaTipo: 'venta',
          referenciaId: venta.id,
        });
      }
    }

    await tx.ventaPago.updateMany({
      where: { ventaId: venta.id },
      data: { estado: 'anulado' },
    });

    await tx.venta.update({
      where: { id: venta.id },
      data: {
        estado: VentaEstado.anulada,
        anuladoAt: new Date(),
      },
    });
  }

  private async updateLoteAndVentas(
    loteId: bigint,
    data: {
      estado: SunatBajaEstado;
      codigo: string | null;
      mensaje: string;
    },
  ) {
    await this.prisma.$transaction([
      this.prisma.sunatBajaLote.update({
        where: { id: loteId },
        data,
      }),
      this.prisma.venta.updateMany({
        where: { sunatBajaLoteId: loteId },
        data: {
          sunatBajaEstado: data.estado,
          sunatBajaCodigo: data.codigo,
          sunatBajaMensaje: data.mensaje,
        },
      }),
    ]);
  }

  private async obtenerOCrearLote(
    tx: Prisma.TransactionClient,
    params: {
      empresaId: bigint;
      tipoEnvio: SunatBajaTipo;
      fechaDocumento: Date;
      fechaGeneracion: Date;
    },
  ) {
    const draft = await tx.sunatBajaLote.findFirst({
      where: {
        empresaId: params.empresaId,
        tipoEnvio: params.tipoEnvio,
        fechaDocumento: params.fechaDocumento,
        fechaGeneracion: params.fechaGeneracion,
        estado: SunatBajaEstado.pendiente_envio,
      },
      orderBy: { id: 'desc' },
    });

    if (draft) {
      return draft;
    }

    const aggregate = await tx.sunatBajaLote.aggregate({
      where: {
        empresaId: params.empresaId,
        tipoEnvio: params.tipoEnvio,
        fechaGeneracion: params.fechaGeneracion,
      },
      _max: { correlativo: true },
    });

    return tx.sunatBajaLote.create({
      data: {
        empresaId: params.empresaId,
        tipoEnvio: params.tipoEnvio,
        fechaDocumento: params.fechaDocumento,
        fechaGeneracion: params.fechaGeneracion,
        correlativo: (aggregate._max.correlativo ?? 0) + 1,
        estado: SunatBajaEstado.pendiente_envio,
        mensaje: 'Lote pendiente de envio a SUNAT.',
      },
    });
  }

  private async findLote(loteId: bigint) {
    const lote = await this.prisma.sunatBajaLote.findUnique({
      where: { id: loteId },
      include: sunatBajaInclude,
    });

    if (!lote) {
      throw new NotFoundException('Lote de baja SUNAT no encontrado');
    }

    return lote;
  }

  private validateSaleForBaja(venta: {
    estado: VentaEstado;
    tipoComprobante: VentaTipoComprobante;
    sunatEstado: SunatEstado;
    sunatXmlKey: string | null;
    sunatZipKey: string | null;
    sunatCdrKey: string | null;
    sunatBajaEstado: SunatBajaEstado | null;
    serie: string;
    numero: number;
  }) {
    if (venta.estado === VentaEstado.anulada) {
      throw new BadRequestException('La venta ya esta anulada');
    }

    if (venta.estado !== VentaEstado.completada) {
      throw new BadRequestException('Solo se pueden anular ventas completadas');
    }

    if (!isElectronicSaleType(venta.tipoComprobante)) {
      throw new BadRequestException('La venta no requiere baja SUNAT');
    }

    if (
      venta.sunatEstado !== SunatEstado.aceptado &&
      venta.sunatEstado !== SunatEstado.observado
    ) {
      throw new BadRequestException(
        'La venta debe estar aceptada u observada por SUNAT antes de solicitar la baja',
      );
    }

    if (
      venta.sunatBajaEstado &&
      blockingBajaStates.includes(venta.sunatBajaEstado)
    ) {
      throw new BadRequestException(
        'La venta ya tiene una baja SUNAT en proceso o aceptada',
      );
    }

    if (!venta.sunatXmlKey || !venta.sunatZipKey || !venta.sunatCdrKey) {
      throw new BadRequestException(
        'No se puede enviar la baja por GEM: la venta no tiene XML/ZIP/CDR SUNAT generado por este sistema.',
      );
    }

    const serie = venta.serie.toUpperCase();
    if (
      venta.tipoComprobante === VentaTipoComprobante.factura &&
      !serie.startsWith('F')
    ) {
      throw new BadRequestException(
        'La factura debe tener una serie electronica que inicie con F',
      );
    }

    if (
      venta.tipoComprobante === VentaTipoComprobante.boleta &&
      !serie.startsWith('B')
    ) {
      throw new BadRequestException(
        'La boleta debe tener una serie electronica que inicie con B',
      );
    }

    if (venta.numero < 1) {
      throw new BadRequestException('La venta no tiene numero valido');
    }
  }

  private resolveTipoEnvio(tipo: VentaTipoComprobante) {
    if (tipo === VentaTipoComprobante.factura) {
      return SunatBajaTipo.RA;
    }

    if (tipo === VentaTipoComprobante.boleta) {
      return SunatBajaTipo.RC;
    }

    throw new BadRequestException('El comprobante no soporta baja SUNAT');
  }

  private async resolveConfig(empresaId: bigint) {
    const config = await this.prisma.sunatConfig.findUnique({
      where: { empresaId },
      include: { empresa: true },
    });

    if (!config?.activo) {
      throw new BadRequestException('La configuracion SUNAT esta inactiva');
    }

    assertSunatEnvironmentAllowed(config.empresa.planCodigo, config.ambiente);

    if (
      !config.usuarioSolEncrypted ||
      !config.claveSolEncrypted ||
      !config.certificadoR2Key ||
      !config.certificadoPasswordEncrypted ||
      !config.empresa.ruc
    ) {
      throw new BadRequestException(
        'La configuracion SUNAT debe tener RUC, Usuario SOL, Clave SOL y certificado',
      );
    }

    const billEndpoint = await this.endpointConfigService.resolveEndpointUrl(
      config.ambiente,
      SunatEndpointCodigo.BILL_SERVICE,
    );

    if (!billEndpoint) {
      throw new BadRequestException(
        'No existe endpoint SUNAT BILL_SERVICE activo para el ambiente configurado',
      );
    }

    const usuarioSol = this.secretsCryptoService.decrypt(
      config.usuarioSolEncrypted,
    );
    const ruc = config.empresa.ruc;

    return {
      ambiente: config.ambiente,
      certificadoR2Key: config.certificadoR2Key,
      certificadoPasswordEncrypted: config.certificadoPasswordEncrypted,
      billEndpoint,
      username: usuarioSol.startsWith(ruc) ? usuarioSol : `${ruc}${usuarioSol}`,
      password: this.secretsCryptoService.decrypt(config.claveSolEncrypted),
    };
  }

  private mapSunatEstado(estado: SunatEstado) {
    if (estado === SunatEstado.aceptado) return SunatBajaEstado.aceptado;
    if (estado === SunatEstado.observado) return SunatBajaEstado.observado;
    if (estado === SunatEstado.rechazado) return SunatBajaEstado.rechazado;
    if (estado === SunatEstado.error_definitivo) {
      return SunatBajaEstado.error_definitivo;
    }
    return SunatBajaEstado.error_transitorio;
  }

  private normalizeMotivo(value: string) {
    const normalized = value?.trim();
    if (!normalized || normalized.length < 5) {
      throw new BadRequestException(
        'La razon de anulacion debe tener al menos 5 caracteres',
      );
    }

    return normalized.slice(0, 255);
  }

  private toDateOnly(value: Date) {
    return new Date(value.toISOString().slice(0, 10));
  }

  private loteNumber(lote: {
    tipoEnvio: SunatBajaTipo;
    fechaGeneracion: Date;
    correlativo: number;
  }) {
    const ymd = lote.fechaGeneracion
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
    return `${lote.tipoEnvio}-${ymd}-${lote.correlativo
      .toString()
      .padStart(3, '0')}`;
  }

  private toBajaResponse(
    venta: {
      publicId: string;
      correlativo: string;
      estado: VentaEstado;
      tipoAnulacion: string | null;
      anuladoRazon: string | null;
      anuladoAt: Date | null;
      sunatBajaEstado: SunatBajaEstado | null;
      sunatBajaCodigo: string | null;
      sunatBajaMensaje: string | null;
      sunatBajaTicket: string | null;
      sunatBajaTipo: SunatBajaTipo | null;
      sunatBajaSolicitadaAt: Date | null;
      sunatBajaRespondidaAt: Date | null;
    },
    lote: {
      tipoEnvio: SunatBajaTipo;
      fechaGeneracion: Date;
      correlativo: number;
      sunatXmlKey: string | null;
      sunatCdrKey: string | null;
    } | null,
  ) {
    return {
      publicId: venta.publicId,
      correlativo: venta.correlativo,
      estado: venta.estado,
      tipoAnulacion: venta.tipoAnulacion,
      razon: venta.anuladoRazon,
      anuladoAt: venta.anuladoAt?.toISOString() ?? null,
      sunatBaja: this.toPublicSunatBaja({
        ...venta,
        sunatBajaLote: lote,
      }),
      message: 'Solicitud de baja SUNAT registrada.',
    };
  }

  private errorMessage(error: unknown) {
    return (
      error instanceof Error
        ? error.message
        : 'No se pudo procesar la baja SUNAT'
    ).slice(0, 500);
  }

  private isDefinitiveError(error: unknown) {
    const normalized = this.errorMessage(error).toLowerCase();
    return (
      normalized.includes('configuracion') ||
      normalized.includes('certificado') ||
      normalized.includes('endpoint') ||
      normalized.includes('ruc') ||
      normalized.includes('xml') ||
      normalized.includes('serie') ||
      normalized.includes('no tiene')
    );
  }

  private zip(fileName: string, content: Buffer) {
    const zip = new JSZip();
    zip.file(fileName, content);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
}
