import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BillingEnvironment, Prisma, SunatEstado } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BillingApiClientService,
  BillingApiError,
} from './billing-api-client.service';
import { BillingIntegrationService } from './billing-integration.service';

export type BillingDespatchGuide = {
  id: string;
  externalId: string;
  status: string;
  series: string;
  number: number;
  fullNumber?: string;
  environment: BillingEnvironment;
  sunatHash?: string | null;
  sunatTicket?: string | null;
  updatedAt?: string;
  artifacts?: Array<{ type: string }>;
  sunat?: {
    code?: string | null;
    message?: string | null;
    observations?: string[];
    submittedAt?: string | null;
    respondedAt?: string | null;
  } | null;
};

type BillingVoidRequest = {
  id: string;
  status: string;
  procedure?: string;
  manualReference?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type ArtifactDescriptor = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
};

const GUIDE_INCLUDE = {
  detalles: true,
  documentosRelacionados: true,
  participantes: true,
  vehiculos: true,
  serieComprobante: true,
  empresa: { select: { billingIntegration: true } },
} satisfies Prisma.GuiaRemisionInclude;

@Injectable()
export class BillingDespatchGuideService {
  private readonly logger = new Logger(BillingDespatchGuideService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: BillingApiClientService,
    private readonly integration: BillingIntegrationService,
  ) {}

  async enqueue(empresaId: bigint, guiaId: bigint) {
    const integration = await this.prisma.billingIntegration.findUnique({
      where: { empresaId },
    });
    if (
      !integration ||
      integration.status !== 'READY' ||
      !integration.applicationId
    ) {
      throw new BadRequestException('La integración Billing no está lista');
    }
    const environment = integration.environment;
    const guide = await this.prisma.guiaRemision.findFirst({
      where: { id: guiaId, empresaId },
      include: { serieComprobante: true },
    });
    if (!guide) throw new NotFoundException('Guía de remisión no encontrada');
    const mapping = await this.prisma.billingSeriesMapping.findUnique({
      where: {
        serieComprobanteId_environment: {
          serieComprobanteId: guide.serieComprobanteId,
          environment,
        },
      },
    });
    if (!mapping) {
      throw new BadRequestException(
        'La serie T no está sincronizada con Billing para este ambiente',
      );
    }
    await this.prisma.$transaction([
      this.prisma.billingDespatchGuideOutbox.upsert({
        where: {
          guiaRemisionId_environment: { guiaRemisionId: guide.id, environment },
        },
        create: {
          empresaId,
          guiaRemisionId: guide.id,
          environment,
          idempotencyKey: `nuvex:${environment.toLowerCase()}:despatch-guide:${guide.publicId}:issue`,
        },
        update: {
          status: 'PENDING',
          nextAttemptAt: new Date(),
          lockedAt: null,
          lastError: null,
          processedAt: null,
        },
      }),
      this.prisma.guiaRemision.update({
        where: { id: guide.id },
        data: {
          estado: 'emitida',
          billingEnvironment: environment,
          billingStatus: 'QUEUED',
          billingLastError: null,
          billingUpdatedAt: new Date(),
          sunatEstado: 'pendiente_envio',
          sunatMensaje: 'GRE programada para envío mediante Nuvex Billing.',
        },
      }),
    ]);
  }

  @Cron('15/10 * * * * *')
  async processOutbox() {
    const jobs = await this.prisma.billingDespatchGuideOutbox.findMany({
      where: {
        status: { in: ['PENDING', 'RETRY'] },
        nextAttemptAt: { lte: new Date() },
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
        ],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: 10,
    });
    for (const job of jobs) {
      try {
        await this.process(job.id);
      } catch (error) {
        this.logger.error(
          `Billing GRE outbox ${job.id}: ${safeMessage(error)}`,
        );
      }
    }
  }

  @Cron('20 */5 * * * *')
  async reconcilePending() {
    const guides = await this.prisma.guiaRemision.findMany({
      where: {
        billingDocumentId: { not: null },
        billingStatus: { in: ['REGISTERED', 'PROCESSING'] },
        OR: [
          { billingUpdatedAt: null },
          { billingUpdatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
        ],
      },
      select: {
        id: true,
        empresaId: true,
        billingDocumentId: true,
        billingEnvironment: true,
      },
      take: 50,
    });
    for (const guide of guides) {
      if (!guide.billingDocumentId || !guide.billingEnvironment) continue;
      try {
        const key = await this.integration.apiKey(
          guide.empresaId,
          guide.billingEnvironment,
        );
        const remote = await this.api.application<BillingDespatchGuide>(
          `/despatch-guides/${guide.billingDocumentId}`,
          key,
        );
        await this.applyGuide(guide.id, remote);
      } catch (error) {
        this.logger.warn(
          `No se pudo conciliar GRE ${guide.id}: ${safeMessage(error)}`,
        );
      }
    }
  }

  async artifact(
    empresaId: bigint,
    publicId: string,
    type: 'XML' | 'CDR' | 'PDF_A4',
  ) {
    const guide = await this.prisma.guiaRemision.findFirst({
      where: { empresaId, publicId },
      select: { billingDocumentId: true, billingEnvironment: true },
    });
    if (!guide?.billingDocumentId || !guide.billingEnvironment) {
      throw new BadRequestException('La GRE no pertenece a Billing');
    }
    const key = await this.integration.apiKey(
      empresaId,
      guide.billingEnvironment,
    );
    return this.api.application<ArtifactDescriptor>(
      `/despatch-guides/${guide.billingDocumentId}/artifacts/${type}`,
      key,
    );
  }

  async refresh(empresaId: bigint, publicId: string) {
    const guide = await this.requiredGuide(empresaId, publicId);
    if (!guide.billingDocumentId || !guide.billingEnvironment) {
      throw new BadRequestException('La GRE no pertenece a Billing');
    }
    const key = await this.integration.apiKey(
      empresaId,
      guide.billingEnvironment,
    );
    const remote = await this.api.application<BillingDespatchGuide>(
      `/despatch-guides/${guide.billingDocumentId}`,
      key,
    );
    await this.applyGuide(guide.id, remote);
    return remote;
  }

  async void(empresaId: bigint, publicId: string, reason: string) {
    const guide = await this.requiredGuide(empresaId, publicId);
    if (!guide.billingDocumentId || !guide.billingEnvironment) {
      throw new BadRequestException('La GRE no pertenece a Billing');
    }
    if (
      !['ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS'].includes(
        guide.billingStatus ?? '',
      )
    ) {
      throw new BadRequestException(
        'Solo se puede dar de baja una GRE aceptada',
      );
    }
    const key = await this.integration.apiKey(
      empresaId,
      guide.billingEnvironment,
    );
    const request = await this.api.application<BillingVoidRequest>(
      `/despatch-guides/${guide.billingDocumentId}/void`,
      key,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': `nuvex:${guide.billingEnvironment.toLowerCase()}:despatch-guide:${guide.publicId}:void`,
        },
        body: JSON.stringify({
          reason: reason.trim(),
          transferStarted: false,
          recipientChanged: false,
        }),
      },
    );
    await this.prisma.guiaRemision.update({
      where: { id: guide.id },
      data: {
        billingVoidRequestId: request.id,
        billingVoidStatus: request.status,
        billingVoidRequestedAt: new Date(),
        anuladoRazon: reason.trim(),
      },
    });
    return request;
  }

  async confirmVoid(empresaId: bigint, publicId: string, solReference: string) {
    const guide = await this.requiredGuide(empresaId, publicId);
    if (
      !guide.billingVoidRequestId ||
      !guide.billingEnvironment ||
      !guide.billingDocumentId
    ) {
      throw new BadRequestException(
        'La GRE no tiene una baja manual pendiente',
      );
    }
    const key = await this.integration.apiKey(
      empresaId,
      guide.billingEnvironment,
    );
    const sequence = (guide.billingAttempts ?? 0) + 1;
    const request = await this.api.application<BillingVoidRequest>(
      `/void-requests/${guide.billingVoidRequestId}/manual-confirmation`,
      key,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': `nuvex:${guide.billingEnvironment.toLowerCase()}:despatch-guide:${guide.publicId}:void-confirm:${sequence}`,
        },
        body: JSON.stringify({
          result: 'ACCEPTED',
          solReference: solReference.trim(),
          notes:
            'Baja de GRE confirmada desde Nuvex después de registrarla en SUNAT SOL.',
        }),
      },
    );
    await this.prisma.guiaRemision.update({
      where: { id: guide.id },
      data: {
        estado: 'anulada',
        billingVoidStatus: request.status,
        billingVoidReference: solReference.trim(),
        billingVoidConfirmedAt: new Date(),
        anuladoAt: new Date(),
      },
    });
    return request;
  }

  async applyWebhook(empresaId: bigint, remote: BillingDespatchGuide) {
    const guide = await this.prisma.guiaRemision.findFirst({
      where: {
        empresaId,
        OR: [
          { billingDocumentId: remote.id },
          { publicId: remote.externalId.replace(/^despatch-guide:/, '') },
        ],
      },
      select: { id: true, billingUpdatedAt: true },
    });
    if (!guide) return false;
    const remoteUpdated = remote.updatedAt
      ? new Date(remote.updatedAt)
      : new Date();
    if (guide.billingUpdatedAt && remoteUpdated < guide.billingUpdatedAt)
      return true;
    await this.applyGuide(guide.id, remote);
    return true;
  }

  async applyVoidWebhook(
    empresaId: bigint,
    request: {
      id: string;
      status: string;
      manualReference?: string | null;
      updatedAt?: string;
      resource: { externalId: string };
    },
  ) {
    const publicId = request.resource.externalId.replace(
      /^despatch-guide:/,
      '',
    );
    const guide = await this.prisma.guiaRemision.findFirst({
      where: { empresaId, publicId },
    });
    if (!guide) return false;
    const accepted = request.status === 'ACCEPTED';
    await this.prisma.guiaRemision.update({
      where: { id: guide.id },
      data: {
        billingVoidRequestId: request.id,
        billingVoidStatus: request.status,
        billingVoidReference:
          request.manualReference ?? guide.billingVoidReference,
        billingVoidConfirmedAt: accepted
          ? new Date()
          : guide.billingVoidConfirmedAt,
        estado: accepted ? 'anulada' : guide.estado,
        anuladoAt: accepted ? new Date() : guide.anuladoAt,
      },
    });
    return true;
  }

  private async process(id: string) {
    const claimed = await this.prisma.billingDespatchGuideOutbox.updateMany({
      where: {
        id,
        status: { in: ['PENDING', 'RETRY'] },
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: new Date(Date.now() - 10 * 60_000) } },
        ],
      },
      data: {
        status: 'PROCESSING',
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return;
    const job = await this.prisma.billingDespatchGuideOutbox.findUniqueOrThrow({
      where: { id },
      include: { guiaRemision: { include: GUIDE_INCLUDE } },
    });
    try {
      const key = await this.integration.apiKey(job.empresaId, job.environment);
      let remote: BillingDespatchGuide;
      if (job.guiaRemision.billingDocumentId) {
        remote = await this.api.application<BillingDespatchGuide>(
          `/despatch-guides/${job.guiaRemision.billingDocumentId}`,
          key,
        );
      } else {
        remote = await this.api.application<BillingDespatchGuide>(
          '/despatch-guides',
          key,
          {
            method: 'POST',
            headers: { 'Idempotency-Key': job.idempotencyKey },
            body: JSON.stringify(this.payload(job.guiaRemision)),
          },
        );
        await this.applyGuide(job.guiaRemision.id, remote);
      }
      remote = await this.api.application<BillingDespatchGuide>(
        `/despatch-guides/${remote.id}/submit`,
        key,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': `${job.idempotencyKey}:submit` },
        },
      );
      await this.applyGuide(job.guiaRemision.id, remote);
      await this.prisma.billingDespatchGuideOutbox.update({
        where: { id },
        data: {
          status: 'DONE',
          lockedAt: null,
          processedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      const retryable = error instanceof BillingApiError && error.retryable;
      const dead = !retryable || job.attempts >= job.maxAttempts;
      const message = safeMessage(error);
      await this.prisma.$transaction([
        this.prisma.billingDespatchGuideOutbox.update({
          where: { id },
          data: {
            status: dead ? 'DEAD' : 'RETRY',
            lockedAt: null,
            lastError: message,
            nextAttemptAt: new Date(Date.now() + retryDelay(job.attempts)),
            processedAt: dead ? new Date() : null,
          },
        }),
        this.prisma.guiaRemision.update({
          where: { id: job.guiaRemision.id },
          data: {
            billingStatus: dead ? 'FAILED' : 'RETRY_SCHEDULED',
            billingLastError: message,
            billingAttempts: job.attempts,
            billingUpdatedAt: new Date(),
            sunatEstado: dead ? 'error_definitivo' : 'error_transitorio',
            sunatMensaje: message,
          },
        }),
      ]);
      throw error;
    }
  }

  private payload(
    guide: Prisma.GuiaRemisionGetPayload<{ include: typeof GUIDE_INCLUDE }>,
  ) {
    const transportista = guide.participantes.find(
      (item) => item.tipo === 'transportista',
    );
    const conductores = guide.participantes.filter(
      (item) => item.tipo === 'conductor',
    );
    return {
      externalId: `despatch-guide:${guide.publicId}`,
      series: guide.serie,
      issueDate: dateOnly(guide.fechaEmision),
      transferStartDate: dateOnly(guide.fechaInicioTraslado),
      carrierDeliveryDate: guide.fechaEntregaTransportista
        ? dateOnly(guide.fechaEntregaTransportista)
        : null,
      transferReasonCode: guide.motivoTraslado,
      transferReasonDescription: guide.descripcionMotivo,
      transportMode: guide.modalidadTransporte === '01' ? 'PUBLIC' : 'PRIVATE',
      grossWeight: guide.pesoBrutoTotal.toFixed(3),
      weightUnit: guide.unidadPeso,
      packageCount: guide.numeroBultos,
      recipient: {
        documentType: partyDocumentType(guide.destinatarioTipoDoc),
        documentNumber: guide.destinatarioNroDoc,
        name: guide.destinatarioRazonSocial,
        address: guide.direccionLlegada,
        ubigeo: guide.ubigeoLlegada,
      },
      departure: {
        ubigeo: guide.ubigeoPartida,
        address: guide.direccionPartida,
      },
      arrival:
        guide.motivoTraslado === '18'
          ? null
          : {
              ubigeo: guide.ubigeoLlegada,
              address: guide.direccionLlegada,
            },
      carrier: transportista
        ? {
            ruc: transportista.numeroDocumento,
            legalName: transportista.razonSocial,
            mtcRegistrationNumber: transportista.registroMtc,
          }
        : null,
      vehicles: guide.vehiculos.map((item) => ({
        plate: item.placa,
        primary: item.esPrincipal,
      })),
      drivers: conductores.map((item) => ({
        documentType: partyDocumentType(item.tipoDocumento),
        documentNumber: item.numeroDocumento,
        firstNames: item.nombres || '-',
        lastNames: item.apellidos || '-',
        licenseNumber: item.licencia,
        primary: item.esPrincipal,
      })),
      items: guide.detalles.map((item) => ({
        externalId: item.id.toString(),
        sku: item.codigoProducto,
        description: item.descripcion,
        quantity: item.cantidad.toString(),
        unitCode: item.unidadMedida,
      })),
      relatedDocuments: guide.documentosRelacionados.map((item) => ({
        documentType: item.tipoDocumento,
        number: item.serie ? `${item.serie}-${item.numero}` : item.numero,
      })),
      metadata: {
        empresaId: guide.empresaId.toString(),
        sucursalId: guide.sucursalId.toString(),
        guiaPublicId: guide.publicId,
      },
    };
  }

  private async applyGuide(guideId: bigint, remote: BillingDespatchGuide) {
    const status = mapStatus(remote.status);
    await this.prisma.guiaRemision.update({
      where: { id: guideId },
      data: {
        billingDocumentId: remote.id,
        billingEnvironment: remote.environment,
        billingStatus: remote.status,
        billingUpdatedAt: remote.updatedAt
          ? new Date(remote.updatedAt)
          : new Date(),
        billingLastError:
          remote.status === 'FAILED' ? (remote.sunat?.message ?? null) : null,
        serie: remote.series,
        numero: remote.number,
        correlativo:
          remote.fullNumber ??
          `${remote.series}-${String(remote.number).padStart(8, '0')}`,
        estado: status.estado,
        sunatEstado: status.sunatEstado,
        sunatCodigo: remote.sunat?.code?.slice(0, 20) ?? null,
        sunatMensaje:
          remote.status === 'VALIDATED_BETA'
            ? 'GRE validada internamente en BETA; no fue enviada a SUNAT.'
            : (remote.sunat?.message?.slice(0, 500) ?? null),
        sunatHash: remote.sunatHash ?? null,
        sunatTicket: remote.sunatTicket ?? null,
        sunatEnviadoAt: remote.sunat?.submittedAt
          ? new Date(remote.sunat.submittedAt)
          : null,
        sunatRespondidoAt: remote.sunat?.respondedAt
          ? new Date(remote.sunat.respondedAt)
          : null,
      },
    });
  }

  private requiredGuide(empresaId: bigint, publicId: string) {
    return this.prisma.guiaRemision.findFirstOrThrow({
      where: { empresaId, publicId },
    });
  }
}

function mapStatus(status: string): {
  estado: 'emitida' | 'aceptada' | 'rechazada';
  sunatEstado: SunatEstado;
} {
  switch (status) {
    case 'ACCEPTED':
      return { estado: 'aceptada', sunatEstado: 'aceptado' };
    case 'ACCEPTED_WITH_OBSERVATIONS':
      return { estado: 'aceptada', sunatEstado: 'observado' };
    case 'REJECTED':
      return { estado: 'rechazada', sunatEstado: 'rechazado' };
    case 'FAILED':
      return { estado: 'emitida', sunatEstado: 'error_definitivo' };
    case 'PROCESSING':
      return { estado: 'emitida', sunatEstado: 'pendiente_cdr' };
    case 'VALIDATED_BETA':
      return { estado: 'emitida', sunatEstado: 'no_aplica' };
    default:
      return { estado: 'emitida', sunatEstado: 'pendiente_envio' };
  }
}

function partyDocumentType(value: string) {
  return value === '6'
    ? 'RUC'
    : value === '1'
      ? 'DNI'
      : value === '7'
        ? 'PASSPORT'
        : 'FOREIGN_ID';
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function retryDelay(attempt: number) {
  return Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : 'Error desconocido')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 1_000);
}
