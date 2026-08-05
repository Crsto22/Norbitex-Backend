import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GuiaRemisionEstado,
  SunatEstado,
  SunatEndpointCodigo,
} from '@prisma/client';
import JSZip from 'jszip';
import { PrismaService } from '../../prisma/prisma.service';
import { assertSunatEnvironmentAllowed } from '../plans/sunat-plan-access';
import { SunatEndpointConfigService } from '../sunat-config/sunat-endpoint-config.service';
import { sha256Base64 } from './sunat-comprobante.helper';
import { SunatCdrParserService } from './sunat-cdr-parser.service';
import {
  SunatDocumentStorageService,
  sunatMetadataState,
} from './sunat-document-storage.service';
import {
  sunatGuiaInclude,
  SunatGuiaRemisionXmlBuilderService,
  type SunatGuia,
} from './sunat-guia-remision-xml-builder.service';
import { SunatRestApiClientService } from './sunat-rest-api-client.service';
import { SunatXmlSignatureService } from './sunat-xml-signature.service';

@Injectable()
export class SunatGuiaRemisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly endpoints: SunatEndpointConfigService,
    private readonly xmlBuilder: SunatGuiaRemisionXmlBuilderService,
    private readonly signature: SunatXmlSignatureService,
    private readonly rest: SunatRestApiClientService,
    private readonly cdrParser: SunatCdrParserService,
    private readonly storage: SunatDocumentStorageService,
  ) {}

  async processGuia(guiaId: bigint) {
    const guia = await this.prisma.guiaRemision.findUnique({
      where: { id: guiaId },
      include: sunatGuiaInclude,
    });
    if (!guia) {
      throw new NotFoundException('Guia de remision no encontrada');
    }

    const mode = (
      this.configService.get<string>('SUNAT_GUIA_REMISION_MODE') ?? 'DISABLED'
    ).toUpperCase();
    if (mode === 'SIMULATED') return this.simulate(guia);
    if (mode !== 'REAL') {
      return this.markError(
        guia.id,
        'GRE_DISABLED',
        'La emision SUNAT GRE REST esta deshabilitada',
        true,
      );
    }

    await this.prisma.guiaRemision.update({
      where: { id: guia.id },
      data: {
        sunatEstado: guia.sunatTicket
          ? SunatEstado.pendiente_cdr
          : SunatEstado.enviando,
        sunatCodigo: null,
        sunatMensaje: guia.sunatTicket
          ? 'Consultando CDR de la guia en SUNAT.'
          : 'Enviando guia de remision a SUNAT.',
      },
    });

    try {
      const config = await this.resolveConfig(guia);
      if (guia.sunatTicket) {
        await this.queryTicket(guia, config);
      } else {
        await this.send(guia, config);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo emitir la GRE';
      await this.markError(
        guia.id,
        this.isDefinitive(message) ? 'CONFIG' : 'ENVIO',
        message,
        this.isDefinitive(message),
      );
    }
  }

  private async send(
    guia: SunatGuia,
    config: Awaited<ReturnType<SunatGuiaRemisionService['resolveConfig']>>,
  ) {
    const base = `${guia.empresa.ruc}-09-${guia.serie}-${guia.numero
      .toString()
      .padStart(8, '0')}`;
    const xmlName = `${base}.xml`;
    const zipName = `${base}.zip`;
    const xml = this.xmlBuilder.build(guia);
    const signed = await this.signature.sign({
      xml,
      certificadoR2Key: config.certificadoR2Key,
      certificadoPasswordEncrypted: config.certificadoPasswordEncrypted,
    });
    const zip = new JSZip();
    zip.file(xmlName, signed.bytes);
    const zipBytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
    const [storedXml, storedZip] = await Promise.all([
      this.storage.storeGuiaDocument({
        empresaId: guia.empresaId,
        ambiente: config.ambiente,
        fecha: guia.fechaEmision,
        fileName: xmlName,
        body: signed.bytes,
        contentType: 'application/xml',
      }),
      this.storage.storeGuiaDocument({
        empresaId: guia.empresaId,
        ambiente: config.ambiente,
        fecha: guia.fechaEmision,
        fileName: zipName,
        body: zipBytes,
        contentType: 'application/zip',
      }),
    ]);
    const sentAt = new Date();
    const pendingMetadata = {
      ambiente: config.ambiente,
      tipoDoc: '09',
      serie: guia.serie,
      correlativo: guia.numero.toString().padStart(8, '0'),
      ticket: null,
      estado: 'PENDIENTE' as const,
      fechaEmision: guia.fechaEmision.toISOString().slice(0, 10),
      fechaEnvio: sentAt.toISOString(),
      fechaProcesado: null,
    };
    await this.storage.storeGuiaMetadata({
      empresaId: guia.empresaId,
      ambiente: config.ambiente,
      fecha: guia.fechaEmision,
      fileBase: base,
      metadata: pendingMetadata,
    });
    const response = await this.rest.sendGuide(config, zipName, zipBytes);
    if (!response.ticket) {
      throw new Error('SUNAT no devolvio ticket para la guia');
    }
    await this.storage.storeGuiaMetadata({
      empresaId: guia.empresaId,
      ambiente: config.ambiente,
      fecha: guia.fechaEmision,
      fileBase: base,
      metadata: { ...pendingMetadata, ticket: response.ticket },
    });

    await this.prisma.guiaRemision.update({
      where: { id: guia.id },
      data: {
        estado: GuiaRemisionEstado.emitida,
        sunatEstado: SunatEstado.pendiente_cdr,
        sunatCodigo: response.code || null,
        sunatMensaje: `Guia recibida por SUNAT. Ticket: ${response.ticket}`,
        sunatHash: signed.digestValue || sha256Base64(signed.bytes),
        sunatTicket: response.ticket,
        sunatXmlNombre: storedXml.nombre,
        sunatXmlKey: storedXml.r2Key,
        sunatZipNombre: storedZip.nombre,
        sunatZipKey: storedZip.r2Key,
        sunatEnviadoAt: sentAt,
      },
    });
  }

  private async queryTicket(
    guia: SunatGuia,
    config: Awaited<ReturnType<SunatGuiaRemisionService['resolveConfig']>>,
  ) {
    const response = await this.rest.getTicket(config, guia.sunatTicket!);
    if (!response.cdr?.length) {
      await this.prisma.guiaRemision.update({
        where: { id: guia.id },
        data: {
          sunatEstado: SunatEstado.pendiente_cdr,
          sunatCodigo: response.code || null,
          sunatMensaje: 'SUNAT aun esta procesando la guia.',
          sunatRespondidoAt: new Date(),
        },
      });
      return;
    }

    const cdr = await this.cdrParser.parse(response.cdr);
    const cdrName = `R-${guia.empresa.ruc}-09-${guia.serie}-${guia.numero
      .toString()
      .padStart(8, '0')}.zip`;
    const stored = await this.storage.storeGuiaDocument({
      empresaId: guia.empresaId,
      ambiente: config.ambiente,
      fecha: guia.fechaEmision,
      fileName: cdrName,
      body: response.cdr,
      contentType: 'application/zip',
    });
    const processedAt = new Date();
    const base = `${guia.empresa.ruc}-09-${guia.serie}-${guia.numero
      .toString()
      .padStart(8, '0')}`;
    await this.storage.storeGuiaMetadata({
      empresaId: guia.empresaId,
      ambiente: config.ambiente,
      fecha: guia.fechaEmision,
      fileBase: base,
      metadata: {
        ambiente: config.ambiente,
        tipoDoc: '09',
        serie: guia.serie,
        correlativo: guia.numero.toString().padStart(8, '0'),
        ticket: guia.sunatTicket,
        estado: sunatMetadataState(cdr.estado),
        fechaEmision: guia.fechaEmision.toISOString().slice(0, 10),
        fechaEnvio: (guia.sunatEnviadoAt ?? processedAt).toISOString(),
        fechaProcesado: processedAt.toISOString(),
      },
    });
    await this.prisma.guiaRemision.update({
      where: { id: guia.id },
      data: {
        estado:
          cdr.estado === SunatEstado.rechazado
            ? GuiaRemisionEstado.rechazada
            : GuiaRemisionEstado.aceptada,
        sunatEstado: cdr.estado,
        sunatCodigo: cdr.codigo,
        sunatMensaje: cdr.mensaje,
        sunatCdrNombre: stored.nombre,
        sunatCdrKey: stored.r2Key,
        sunatRespondidoAt: processedAt,
      },
    });
  }

  private async resolveConfig(guia: SunatGuia) {
    const config = await this.prisma.sunatConfig.findUnique({
      where: { empresaId: guia.empresaId },
    });
    if (!config?.activo) {
      throw new BadRequestException('La configuracion SUNAT esta inactiva');
    }
    assertSunatEnvironmentAllowed(guia.empresa.planCodigo, config.ambiente);
    if (
      !config.usuarioSolEncrypted ||
      !config.claveSolEncrypted ||
      !config.clientIdEncrypted ||
      !config.clientSecretEncrypted ||
      !config.certificadoR2Key ||
      !config.certificadoPasswordEncrypted ||
      !/^\d{11}$/.test(guia.empresa.ruc ?? '')
    ) {
      throw new BadRequestException(
        'GRE requiere RUC, Usuario SOL, Clave SOL, clientId, clientSecret y certificado',
      );
    }
    for (const code of [
      SunatEndpointCodigo.API_TOKEN,
      SunatEndpointCodigo.API_CPE,
    ]) {
      if (!(await this.endpoints.resolveEndpointUrl(config.ambiente, code))) {
        throw new BadRequestException(`No existe endpoint SUNAT ${code}`);
      }
    }
    return {
      id: config.id,
      ambiente: config.ambiente,
      ruc: guia.empresa.ruc!,
      usuarioSolEncrypted: config.usuarioSolEncrypted,
      claveSolEncrypted: config.claveSolEncrypted,
      clientIdEncrypted: config.clientIdEncrypted,
      clientSecretEncrypted: config.clientSecretEncrypted,
      certificadoR2Key: config.certificadoR2Key,
      certificadoPasswordEncrypted: config.certificadoPasswordEncrypted,
    };
  }

  private async simulate(guia: SunatGuia) {
    await this.prisma.guiaRemision.update({
      where: { id: guia.id },
      data: {
        estado: GuiaRemisionEstado.aceptada,
        sunatEstado: SunatEstado.aceptado,
        sunatCodigo: '0',
        sunatMensaje: 'Guia aceptada en modo simulado.',
        sunatHash: sha256Base64(`${guia.correlativo}|${Date.now()}`),
        sunatTicket: `SIM-${guia.correlativo}`,
        sunatEnviadoAt: new Date(),
        sunatRespondidoAt: new Date(),
      },
    });
  }

  private async markError(
    id: bigint,
    code: string,
    message: string,
    definitive: boolean,
  ) {
    await this.prisma.guiaRemision.update({
      where: { id },
      data: {
        estado: GuiaRemisionEstado.emitida,
        sunatEstado: definitive
          ? SunatEstado.error_definitivo
          : SunatEstado.error_transitorio,
        sunatCodigo: code,
        sunatMensaje: message.slice(0, 500),
        sunatRespondidoAt: new Date(),
      },
    });
  }

  private isDefinitive(message: string) {
    const value = message.toLowerCase();
    return [
      'configuracion',
      'certificado',
      'clientid',
      'clientsecret',
      'endpoint',
      'ruc',
      'razon social',
      'motivo de traslado',
      'no tiene productos',
    ].some((text) => value.includes(text));
  }
}
