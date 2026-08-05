import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SunatEndpointCodigo,
  SunatEstado,
  SunatJobEstado,
  SunatJobTipoDocumento,
} from '@prisma/client';
import JSZip from 'jszip';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SunatEndpointConfigService } from '../sunat-config/sunat-endpoint-config.service';
import {
  buildSunatFileBase,
  isElectronicSaleType,
  sha256Base64,
  sunatDocumentCode,
} from './sunat-comprobante.helper';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import {
  SunatDocumentStorageService,
  sunatMetadataState,
} from './sunat-document-storage.service';
import { SunatSoapClientService } from './sunat-soap-client.service';
import { SunatXmlBuilderService } from './sunat-xml-builder.service';
import { SunatXmlSignatureService } from './sunat-xml-signature.service';
import { assertSunatEnvironmentAllowed } from '../plans/sunat-plan-access';

const sunatSaleInclude = {
  empresa: true,
  sucursal: true,
  cliente: true,
  detalles: {
    include: {
      productoVariante: {
        include: {
          producto: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.VentaInclude;

type SunatSale = Prisma.VentaGetPayload<{ include: typeof sunatSaleInclude }>;

@Injectable()
export class SunatEmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretsCryptoService: SecretsCryptoService,
    private readonly endpointConfigService: SunatEndpointConfigService,
    private readonly xmlBuilderService: SunatXmlBuilderService,
    private readonly xmlSignatureService: SunatXmlSignatureService,
    private readonly soapClientService: SunatSoapClientService,
    private readonly cdrParserService: SunatCdrParserService,
    private readonly documentStorageService: SunatDocumentStorageService,
  ) {}

  async processVenta(ventaId: bigint) {
    const sale = await this.prisma.venta.findUnique({
      where: { id: ventaId },
      include: sunatSaleInclude,
    });

    if (!sale) {
      throw new NotFoundException('Venta no encontrada');
    }

    if (!isElectronicSaleType(sale.tipoComprobante)) {
      await this.prisma.venta.update({
        where: { id: sale.id },
        data: {
          sunatEstado: SunatEstado.no_aplica,
          sunatMensaje: 'La venta no requiere emision electronica SUNAT.',
        },
      });
      return;
    }

    await this.markSending(sale.id);

    try {
      const config = await this.resolveConfig(sale);
      const fileBase = buildSunatFileBase({
        ruc: sale.empresa.ruc!,
        tipoComprobante: sale.tipoComprobante,
        serie: sale.serie,
        numero: sale.numero,
      });
      const xmlName = `${fileBase}.xml`;
      const zipName = `${fileBase}.zip`;
      const xml = this.xmlBuilderService.build(sale);
      const signed = await this.xmlSignatureService.sign({
        xml,
        certificadoR2Key: config.certificadoR2Key,
        certificadoPasswordEncrypted: config.certificadoPasswordEncrypted,
      });
      const zipBytes = await this.zip(xmlName, signed.bytes);
      const xmlStored = await this.documentStorageService.storeSaleDocument({
        empresaId: sale.empresaId,
        ambiente: config.ambiente,
        tipoComprobante: sale.tipoComprobante,
        fecha: sale.createdAt,
        fileName: xmlName,
        body: signed.bytes,
        contentType: 'application/xml',
      });
      const zipStored = await this.documentStorageService.storeSaleDocument({
        empresaId: sale.empresaId,
        ambiente: config.ambiente,
        tipoComprobante: sale.tipoComprobante,
        fecha: sale.createdAt,
        fileName: zipName,
        body: zipBytes,
        contentType: 'application/zip',
      });
      const sentAt = new Date();
      const metadata = {
        ambiente: config.ambiente,
        tipoDoc: sunatDocumentCode(sale.tipoComprobante),
        serie: sale.serie,
        correlativo: sale.numero.toString().padStart(8, '0'),
        ticket: null,
        estado: 'PENDIENTE' as const,
        fechaEmision: sale.createdAt.toISOString().slice(0, 10),
        fechaEnvio: sentAt.toISOString(),
        fechaProcesado: null,
      };
      await this.documentStorageService.storeSaleMetadata({
        empresaId: sale.empresaId,
        ambiente: config.ambiente,
        tipoComprobante: sale.tipoComprobante,
        fecha: sale.createdAt,
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
        empresaId: sale.empresaId,
        ambiente: config.ambiente,
        tipoComprobante: sale.tipoComprobante,
        fecha: sale.createdAt,
        fileName: soapResponse.cdrZipFileName,
        body: soapResponse.cdrZipBytes,
        contentType: 'application/zip',
      });
      const processedAt = new Date();
      await this.documentStorageService.storeSaleMetadata({
        empresaId: sale.empresaId,
        ambiente: config.ambiente,
        tipoComprobante: sale.tipoComprobante,
        fecha: sale.createdAt,
        fileBase,
        metadata: {
          ...metadata,
          estado: sunatMetadataState(cdr.estado),
          fechaProcesado: processedAt.toISOString(),
        },
      });

      await this.prisma.venta.update({
        where: { id: sale.id },
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
    } catch (error) {
      await this.markError(sale.id, error);
    }
  }

  async getSaleSunatStatus(empresaId: bigint, publicId: string) {
    const sale = await this.prisma.venta.findFirst({
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

    if (!sale) {
      throw new NotFoundException('Venta no encontrada');
    }

    return {
      publicId: sale.publicId,
      tipoComprobante: sale.tipoComprobante,
      correlativo: sale.correlativo,
      estado: sale.sunatEstado,
      codigo: sale.sunatCodigo,
      mensaje: sale.sunatMensaje,
      hash: sale.sunatHash,
      enviadoAt: sale.sunatEnviadoAt?.toISOString() ?? null,
      respondidoAt: sale.sunatRespondidoAt?.toISOString() ?? null,
      archivos: {
        xml: sale.sunatXmlKey ? { nombre: sale.sunatXmlNombre } : null,
        cdr: sale.sunatCdrKey ? { nombre: sale.sunatCdrNombre } : null,
      },
    };
  }

  async downloadSaleArtifact(
    empresaId: bigint,
    publicId: string,
    artifact: 'xml' | 'cdr',
  ) {
    const sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      select: {
        sunatXmlNombre: true,
        sunatXmlKey: true,
        sunatCdrNombre: true,
        sunatCdrKey: true,
      },
    });

    if (!sale) {
      throw new NotFoundException('Venta no encontrada');
    }

    const key = artifact === 'xml' ? sale.sunatXmlKey : sale.sunatCdrKey;
    const fileName =
      artifact === 'xml' ? sale.sunatXmlNombre : sale.sunatCdrNombre;

    if (!key || !fileName) {
      throw new NotFoundException('Archivo SUNAT no disponible');
    }

    return {
      fileName,
      url: await this.documentStorageService.signedDownloadUrl(key, fileName),
    };
  }

  async retrySale(empresaId: bigint, publicId: string) {
    const sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      select: { id: true, empresaId: true, tipoComprobante: true },
    });

    if (!sale) {
      throw new NotFoundException('Venta no encontrada');
    }

    if (!isElectronicSaleType(sale.tipoComprobante)) {
      throw new BadRequestException(
        'La venta no requiere emision electronica SUNAT',
      );
    }

    await this.prisma.$transaction([
      this.prisma.venta.update({
        where: { id: sale.id },
        data: {
          sunatEstado: SunatEstado.pendiente_envio,
          sunatCodigo: null,
          sunatMensaje: 'Reintento programado de envio a SUNAT.',
        },
      }),
      this.prisma.sunatJob.upsert({
        where: {
          tipoDocumento_documentoId: {
            tipoDocumento: SunatJobTipoDocumento.venta,
            documentoId: sale.id,
          },
        },
        create: {
          empresaId: sale.empresaId,
          tipoDocumento: SunatJobTipoDocumento.venta,
          documentoId: sale.id,
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

    return this.getSaleSunatStatus(empresaId, publicId);
  }

  private async resolveConfig(sale: SunatSale) {
    const config = await this.prisma.sunatConfig.findUnique({
      where: { empresaId: sale.empresaId },
    });

    if (!config?.activo) {
      throw new BadRequestException('La configuracion SUNAT esta inactiva');
    }

    assertSunatEnvironmentAllowed(sale.empresa.planCodigo, config.ambiente);

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
        'No existe endpoint SUNAT BILL_SERVICE activo para el ambiente configurado',
      );
    }

    const usuarioSol = this.secretsCryptoService.decrypt(
      config.usuarioSolEncrypted,
    );
    const ruc = sale.empresa.ruc!;

    return {
      ambiente: config.ambiente,
      certificadoR2Key: config.certificadoR2Key,
      certificadoPasswordEncrypted: config.certificadoPasswordEncrypted,
      billEndpoint,
      username: usuarioSol.startsWith(ruc) ? usuarioSol : `${ruc}${usuarioSol}`,
      password: this.secretsCryptoService.decrypt(config.claveSolEncrypted),
    };
  }

  private async markSending(id: bigint) {
    await this.prisma.venta.update({
      where: { id },
      data: {
        sunatEstado: SunatEstado.enviando,
        sunatCodigo: null,
        sunatMensaje: 'Procesando envio del comprobante a SUNAT.',
      },
    });
  }

  private async markError(id: bigint, error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'No se pudo emitir el comprobante en SUNAT';
    const definitive = this.isDefinitiveError(message);

    await this.prisma.venta.update({
      where: { id },
      data: {
        sunatEstado: definitive
          ? SunatEstado.error_definitivo
          : SunatEstado.error_transitorio,
        sunatCodigo: definitive ? 'CONFIG' : 'ENVIO',
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
