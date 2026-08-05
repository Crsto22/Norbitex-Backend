import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SunatEndpointCodigo,
  SunatEstado,
  StockMovimientoTipo,
  SunatJobEstado,
  SunatJobTipoDocumento,
  VentaEstado,
} from '@prisma/client';
import { StockService } from '../stock/stock.service';
import JSZip from 'jszip';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SunatEndpointConfigService } from '../sunat-config/sunat-endpoint-config.service';
import { buildSunatFileBase, sha256Base64 } from './sunat-comprobante.helper';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import { SunatCreditNoteXmlBuilderService } from './sunat-credit-note-xml-builder.service';
import {
  SunatDocumentStorageService,
  sunatMetadataState,
} from './sunat-document-storage.service';
import { SunatSoapClientService } from './sunat-soap-client.service';
import { SunatXmlSignatureService } from './sunat-xml-signature.service';
import { assertSunatEnvironmentAllowed } from '../plans/sunat-plan-access';

const creditNoteSunatInclude = {
  empresa: true,
  sucursal: true,
  cliente: true,
  ventaReferencia: true,
  detalles: {
    include: {
      productoVariante: { include: { producto: true } },
      ventaDetalleReferencia: true,
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.NotaCreditoInclude;

type CreditNoteForSunat = Prisma.NotaCreditoGetPayload<{
  include: typeof creditNoteSunatInclude;
}>;

@Injectable()
export class SunatCreditNoteEmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretsCryptoService: SecretsCryptoService,
    private readonly endpointConfigService: SunatEndpointConfigService,
    private readonly xmlBuilderService: SunatCreditNoteXmlBuilderService,
    private readonly xmlSignatureService: SunatXmlSignatureService,
    private readonly soapClientService: SunatSoapClientService,
    private readonly cdrParserService: SunatCdrParserService,
    private readonly documentStorageService: SunatDocumentStorageService,
    private readonly stockService: StockService,
  ) {}

  async process(noteId: bigint) {
    const note = await this.prisma.notaCredito.findUnique({
      where: { id: noteId },
      include: creditNoteSunatInclude,
    });
    if (!note) {
      throw new NotFoundException('Nota de credito no encontrada');
    }

    await this.markSending(note.id);
    try {
      const config = await this.resolveConfig(note);
      const fileBase = buildSunatFileBase({
        ruc: note.empresa.ruc!,
        tipoComprobante: note.tipoComprobante,
        serie: note.serie,
        numero: note.numero,
      });
      const xmlName = `${fileBase}.xml`;
      const zipName = `${fileBase}.zip`;
      const xml = this.xmlBuilderService.build(note);
      const signed = await this.xmlSignatureService.sign({
        xml,
        certificadoR2Key: config.certificadoR2Key,
        certificadoPasswordEncrypted: config.certificadoPasswordEncrypted,
      });
      const zipBytes = await this.zip(xmlName, signed.bytes);
      const xmlStored = await this.documentStorageService.storeSaleDocument({
        empresaId: note.empresaId,
        ambiente: config.ambiente,
        tipoComprobante: note.tipoComprobante,
        fecha: note.createdAt,
        fileName: xmlName,
        body: signed.bytes,
        contentType: 'application/xml',
      });
      const zipStored = await this.documentStorageService.storeSaleDocument({
        empresaId: note.empresaId,
        ambiente: config.ambiente,
        tipoComprobante: note.tipoComprobante,
        fecha: note.createdAt,
        fileName: zipName,
        body: zipBytes,
        contentType: 'application/zip',
      });
      const sentAt = new Date();
      const metadata = {
        ambiente: config.ambiente,
        tipoDoc: '07',
        serie: note.serie,
        correlativo: note.numero.toString().padStart(8, '0'),
        ticket: null,
        estado: 'PENDIENTE' as const,
        fechaEmision: note.createdAt.toISOString().slice(0, 10),
        fechaEnvio: sentAt.toISOString(),
        fechaProcesado: null,
      };
      await this.documentStorageService.storeSaleMetadata({
        empresaId: note.empresaId,
        ambiente: config.ambiente,
        tipoComprobante: note.tipoComprobante,
        fecha: note.createdAt,
        fileBase,
        metadata,
      });
      const soapResponse = await this.soapClientService.sendBill({
        endpoint: config.billEndpoint,
        username: config.username,
        password: config.password,
        zipFileName: zipName,
        zipBytes,
      });
      const cdr = await this.cdrParserService.parse(soapResponse.cdrZipBytes);
      const cdrStored = await this.documentStorageService.storeSaleDocument({
        empresaId: note.empresaId,
        ambiente: config.ambiente,
        tipoComprobante: note.tipoComprobante,
        fecha: note.createdAt,
        fileName: soapResponse.cdrZipFileName,
        body: soapResponse.cdrZipBytes,
        contentType: 'application/zip',
      });
      const processedAt = new Date();
      await this.documentStorageService.storeSaleMetadata({
        empresaId: note.empresaId,
        ambiente: config.ambiente,
        tipoComprobante: note.tipoComprobante,
        fecha: note.createdAt,
        fileBase,
        metadata: {
          ...metadata,
          estado: sunatMetadataState(cdr.estado),
          fechaProcesado: processedAt.toISOString(),
        },
      });

      await this.prisma.notaCredito.update({
        where: { id: note.id },
        data: {
          sunatEstado: cdr.estado,
          sunatCodigo: cdr.codigo,
          sunatMensaje: cdr.mensaje,
          sunatHash: signed.digestValue || sha256Base64(signed.bytes),
          sunatXmlNombre: xmlStored.nombre,
          sunatXmlKey: xmlStored.r2Key,
          sunatZipNombre: zipStored.nombre,
          sunatZipKey: zipStored.r2Key,
          sunatCdrNombre: cdrStored.nombre,
          sunatCdrKey: cdrStored.r2Key,
          sunatEnviadoAt: sentAt,
          sunatRespondidoAt: processedAt,
        },
      });

      if (
        cdr.estado === SunatEstado.aceptado ||
        cdr.estado === SunatEstado.observado
      ) {
        await this.applyAcceptedEffects(note.id);
      }
    } catch (error) {
      await this.markError(note.id, error);
    }
  }

  async retry(empresaId: bigint, publicId: string) {
    const note = await this.prisma.notaCredito.findFirst({
      where: { empresaId, publicId },
      select: { id: true, empresaId: true },
    });
    if (!note) {
      throw new NotFoundException('Nota de credito no encontrada');
    }

    await this.prisma.$transaction([
      this.prisma.notaCredito.update({
        where: { id: note.id },
        data: {
          sunatEstado: SunatEstado.pendiente_envio,
          sunatCodigo: null,
          sunatMensaje: 'Reintento programado de envio a SUNAT.',
        },
      }),
      this.prisma.sunatJob.upsert({
        where: {
          tipoDocumento_documentoId: {
            tipoDocumento: SunatJobTipoDocumento.nota_credito,
            documentoId: note.id,
          },
        },
        create: {
          empresaId: note.empresaId,
          tipoDocumento: SunatJobTipoDocumento.nota_credito,
          documentoId: note.id,
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
      }),
    ]);

    return this.getStatus(empresaId, publicId);
  }

  async getStatus(empresaId: bigint, publicId: string) {
    const note = await this.prisma.notaCredito.findFirst({
      where: { empresaId, publicId },
      select: {
        publicId: true,
        tipoComprobante: true,
        correlativo: true,
        sunatEstado: true,
        sunatCodigo: true,
        sunatMensaje: true,
        sunatHash: true,
        sunatXmlNombre: true,
        sunatXmlKey: true,
        sunatCdrNombre: true,
        sunatCdrKey: true,
        sunatEnviadoAt: true,
        sunatRespondidoAt: true,
      },
    });
    if (!note) {
      throw new NotFoundException('Nota de credito no encontrada');
    }
    return {
      publicId: note.publicId,
      tipoComprobante: note.tipoComprobante,
      correlativo: note.correlativo,
      estado: note.sunatEstado,
      codigo: note.sunatCodigo,
      mensaje: note.sunatMensaje,
      hash: note.sunatHash,
      enviadoAt: note.sunatEnviadoAt?.toISOString() ?? null,
      respondidoAt: note.sunatRespondidoAt?.toISOString() ?? null,
      archivos: {
        xml: note.sunatXmlKey ? { nombre: note.sunatXmlNombre } : null,
        cdr: note.sunatCdrKey ? { nombre: note.sunatCdrNombre } : null,
      },
    };
  }

  async downloadArtifact(
    empresaId: bigint,
    publicId: string,
    artifact: 'xml' | 'cdr',
  ) {
    const note = await this.prisma.notaCredito.findFirst({
      where: { empresaId, publicId },
      select: {
        sunatXmlNombre: true,
        sunatXmlKey: true,
        sunatCdrNombre: true,
        sunatCdrKey: true,
      },
    });
    if (!note) {
      throw new NotFoundException('Nota de credito no encontrada');
    }
    const key = artifact === 'xml' ? note.sunatXmlKey : note.sunatCdrKey;
    const fileName =
      artifact === 'xml' ? note.sunatXmlNombre : note.sunatCdrNombre;
    if (!key || !fileName) {
      throw new NotFoundException('Archivo SUNAT no disponible');
    }
    return {
      fileName,
      url: await this.documentStorageService.signedDownloadUrl(key, fileName),
    };
  }

  private async resolveConfig(note: CreditNoteForSunat) {
    const config = await this.prisma.sunatConfig.findUnique({
      where: { empresaId: note.empresaId },
    });
    if (!config?.activo) {
      throw new BadRequestException('La configuracion SUNAT esta inactiva');
    }
    assertSunatEnvironmentAllowed(note.empresa.planCodigo, config.ambiente);
    if (
      !config.usuarioSolEncrypted ||
      !config.claveSolEncrypted ||
      !config.certificadoR2Key ||
      !config.certificadoPasswordEncrypted
    ) {
      throw new BadRequestException(
        'La configuracion SUNAT debe tener Usuario SOL, Clave SOL y certificado',
      );
    }
    const billEndpoint = await this.endpointConfigService.resolveEndpointUrl(
      config.ambiente,
      SunatEndpointCodigo.BILL_SERVICE,
    );
    if (!billEndpoint) {
      throw new BadRequestException(
        'No existe endpoint SUNAT BILL_SERVICE activo',
      );
    }
    const usuarioSol = this.secretsCryptoService.decrypt(
      config.usuarioSolEncrypted,
    );
    const ruc = note.empresa.ruc!;
    return {
      ambiente: config.ambiente,
      certificadoR2Key: config.certificadoR2Key,
      certificadoPasswordEncrypted: config.certificadoPasswordEncrypted,
      billEndpoint,
      username: usuarioSol.startsWith(ruc) ? usuarioSol : `${ruc}${usuarioSol}`,
      password: this.secretsCryptoService.decrypt(config.claveSolEncrypted),
    };
  }

  private async applyAcceptedEffects(noteId: bigint) {
    const note = await this.prisma.notaCredito.findUnique({
      where: { id: noteId },
      include: {
        ventaReferencia: true,
        detalles: { include: { ventaDetalleReferencia: true } },
      },
    });
    if (!note || note.stockDevuelto) return;

    await this.prisma.$transaction(async (tx) => {
      if (['06', '07'].includes(note.codigoMotivo) && note.sucursalId) {
        for (const detail of note.detalles) {
          await this.stockService.changeStock(tx, {
            empresaId: note.empresaId,
            sucursalId: note.sucursalId,
            productoVarianteId: detail.productoVarianteId,
            delta: detail.cantidad,
            tipo: StockMovimientoTipo.nota_credito,
            motivo: note.descripcionMotivo,
            creadoPorId: note.creadoPorId,
            referenciaTipo: 'nota_credito',
            referenciaId: note.id,
          });
        }
      }

      await tx.notaCredito.update({
        where: { id: note.id },
        data: { stockDevuelto: ['06', '07'].includes(note.codigoMotivo) },
      });
      await tx.venta.update({
        where: { id: note.ventaReferenciaId },
        data: {
          estado:
            note.codigoMotivo === '06'
              ? VentaEstado.anulada
              : VentaEstado.nc_emitida,
          tipoAnulacion: 'nota_credito',
          anuladoRazon: note.descripcionMotivo,
          ...(note.codigoMotivo === '06' ? { anuladoAt: new Date() } : {}),
        },
      });
    });
  }

  private async markSending(id: bigint) {
    await this.prisma.notaCredito.update({
      where: { id },
      data: {
        sunatEstado: SunatEstado.enviando,
        sunatCodigo: null,
        sunatMensaje: 'Procesando envio de nota de credito a SUNAT.',
      },
    });
  }

  private async markError(id: bigint, error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'No se pudo emitir la nota de credito en SUNAT';
    await this.prisma.notaCredito.update({
      where: { id },
      data: {
        sunatEstado: this.isDefinitiveError(message)
          ? SunatEstado.error_definitivo
          : SunatEstado.error_transitorio,
        sunatCodigo: this.isDefinitiveError(message) ? 'CONFIG' : 'ENVIO',
        sunatMensaje: message.slice(0, 500),
        sunatRespondidoAt: new Date(),
      },
    });
  }

  private isDefinitiveError(message: string) {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('configuracion') ||
      normalized.includes('certificado') ||
      normalized.includes('endpoint') ||
      normalized.includes('ruc') ||
      normalized.includes('cliente') ||
      normalized.includes('xml')
    );
  }

  private zip(fileName: string, content: Buffer) {
    const zip = new JSZip();
    zip.file(fileName, content);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
}
