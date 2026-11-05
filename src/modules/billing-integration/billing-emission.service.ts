import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  BillingDocumentStatus,
  BillingEnvironment,
  Prisma,
  SunatEstado,
  VentaFormaPago,
  VentaTipoComprobante,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BillingApiClientService,
  BillingApiError,
} from './billing-api-client.service';
import { BillingIntegrationService } from './billing-integration.service';
import { BillingVoidService } from './billing-void.service';

type BillingDocument = {
  id: string;
  externalId: string;
  status: BillingDocumentStatus | 'RECEIVED' | 'VALIDATING';
  series: string;
  number: number;
  fullNumber?: string;
  environment: BillingEnvironment;
  updatedAt?: string;
  sunat?: {
    code?: string | null;
    message?: string | null;
    observations?: string[];
    submittedAt?: string | null;
    respondedAt?: string | null;
  };
};

type ArtifactDescriptor = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  url: string;
};

@Injectable()
export class BillingEmissionService {
  private readonly logger = new Logger(BillingEmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: BillingApiClientService,
    private readonly integration: BillingIntegrationService,
    private readonly voids: BillingVoidService,
  ) {}

  @Cron('* * * * * *')
  async processOutbox() {
    const lockExpiredAt = new Date(Date.now() - 10 * 60_000);
    const jobs = await this.prisma.billingOutbox.findMany({
      where: {
        status: { in: ['PENDING', 'RETRY'] },
        nextAttemptAt: { lte: new Date() },
        OR: [{ lockedAt: null }, { lockedAt: { lt: lockExpiredAt } }],
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      take: 10,
    });
    for (const job of jobs) {
      try {
        await this.process(job.id);
      } catch (error) {
        this.logger.error(`Billing outbox ${job.id}: ${safeMessage(error)}`);
      }
    }
  }

  @Cron('15 */5 * * * *')
  async reconcilePending() {
    const sales = await this.prisma.venta.findMany({
      where: {
        billingDocumentId: { not: null },
        billingStatus: {
          in: ['QUEUED', 'PROCESSING', 'RETRY_SCHEDULED'],
        },
        billingUpdatedAt: { lt: new Date(Date.now() - 5 * 60_000) },
      },
      select: {
        publicId: true,
        tipoComprobante: true,
        sunatEstado: true,
        id: true,
        empresaId: true,
        billingDocumentId: true,
        billingEnvironment: true,
      },
      take: 50,
    });
    for (const sale of sales) {
      if (!sale.billingDocumentId || !sale.billingEnvironment) continue;
      try {
        const apiKey = await this.integration.apiKey(
          sale.empresaId,
          sale.billingEnvironment,
        );
        const document = await this.api.application<BillingDocument>(
          `/documents/${sale.billingDocumentId}`,
          apiKey,
        );
        await this.applyDocument(sale.id, document);
      } catch (error) {
        this.logger.warn(
          `No se pudo conciliar venta ${sale.id}: ${safeMessage(error)}`,
        );
      }
    }
  }

  async enqueue(
    tx: Prisma.TransactionClient,
    input: {
      empresaId: bigint;
      ventaId: bigint;
      environment: BillingEnvironment;
      publicId: string;
    },
  ) {
    const idempotencyKey = `nuvex:${input.environment.toLowerCase()}:sale:${input.publicId}:issue`;
    await tx.billingOutbox.upsert({
      where: {
        ventaId_environment_operation: {
          ventaId: input.ventaId,
          environment: input.environment,
          operation: 'ISSUE',
        },
      },
      create: {
        empresaId: input.empresaId,
        ventaId: input.ventaId,
        environment: input.environment,
        idempotencyKey,
      },
      update: {
        status: 'PENDING',
        nextAttemptAt: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });
  }

  async retry(empresaId: bigint, publicId: string) {
    const sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (!sale.billingEnvironment) {
      throw new BadRequestException('La venta no pertenece a Billing');
    }
    if (sale.billingDocumentId) {
      const apiKey = await this.integration.apiKey(
        empresaId,
        sale.billingEnvironment,
      );
      const result = await this.api.application<BillingDocument>(
        `/documents/${sale.billingDocumentId}/retry`,
        apiKey,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': `nuvex:${sale.billingEnvironment.toLowerCase()}:sale:${sale.publicId}:retry`,
          },
        },
      );
      await this.applyDocument(sale.id, result);
      return result;
    }
    await this.prisma.billingOutbox.updateMany({
      where: { ventaId: sale.id },
      data: {
        status: 'PENDING',
        nextAttemptAt: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });
    return { status: 'QUEUED' };
  }

  async status(empresaId: bigint, publicId: string) {
    const sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      select: {
        publicId: true,
        tipoComprobante: true,
        sunatEstado: true,
        billingDocumentId: true,
        billingEnvironment: true,
        billingStatus: true,
        billingUpdatedAt: true,
        billingSunatObservations: true,
        billingLastError: true,
        sunatCodigo: true,
        sunatMensaje: true,
        sunatEnviadoAt: true,
        sunatRespondidoAt: true,
        serie: true,
        numero: true,
        correlativo: true,
      },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    return {
      publicId: sale.publicId,
      tipoComprobante: sale.tipoComprobante,
      correlativo: sale.correlativo,
      estado: sale.sunatEstado,
      codigo: sale.sunatCodigo,
      mensaje: sale.sunatMensaje,
      hash: null,
      enviadoAt: sale.sunatEnviadoAt,
      respondidoAt: sale.sunatRespondidoAt,
      archivos: {
        xml: accepted(sale.billingStatus) ? { nombre: null } : null,
        cdr: accepted(sale.billingStatus) ? { nombre: null } : null,
      },
      provider: 'NUVEX_BILLING',
      documentId: sale.billingDocumentId,
      environment: sale.billingEnvironment,
      status: sale.billingStatus ?? 'QUEUED',
      series: sale.serie,
      number: sale.numero > 0 ? sale.numero : null,
      fullNumber: sale.numero > 0 ? sale.correlativo : null,
      sunat: {
        code: sale.sunatCodigo,
        message: sale.sunatMensaje,
        observations: sale.billingSunatObservations,
        submittedAt: sale.sunatEnviadoAt,
        respondedAt: sale.sunatRespondidoAt,
      },
      lastError: sale.billingLastError,
      updatedAt: sale.billingUpdatedAt,
    };
  }

  async artifact(
    empresaId: bigint,
    publicId: string,
    type: 'XML' | 'CDR' | 'PDF_A4' | 'PDF_TICKET',
  ) {
    const printable = type === 'PDF_A4' || type === 'PDF_TICKET';
    let sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      select: {
        id: true,
        billingDocumentId: true,
        billingEnvironment: true,
        billingStatus: true,
      },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');

    if (!printable) {
      if (!sale.billingDocumentId || !sale.billingEnvironment) {
        throw new NotFoundException('El comprobante aun no tiene artefactos');
      }
      if (!accepted(sale.billingStatus)) {
        throw new BadRequestException(
          'Los archivos estaran disponibles cuando SUNAT acepte el comprobante',
        );
      }
      return this.downloadArtifact(empresaId, sale, type);
    }

    // El usuario puede imprimir inmediatamente despues de cobrar. Si la cola
    // todavia no reservo el correlativo, se procesa ahora sin esperar al cron.
    if (!sale.billingDocumentId) {
      const pendingJob = await this.prisma.billingOutbox.findFirst({
        where: {
          ventaId: sale.id,
          operation: 'ISSUE',
          status: { in: ['PENDING', 'RETRY'] },
          nextAttemptAt: { lte: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (pendingJob) await this.process(pendingJob.id);
    }

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      sale = await this.prisma.venta.findFirst({
        where: { empresaId, publicId },
        select: {
          id: true,
          billingDocumentId: true,
          billingEnvironment: true,
          billingStatus: true,
        },
      });
      if (!sale) throw new NotFoundException('Venta no encontrada');
      if (sale.billingStatus === 'FAILED') {
        throw new BadRequestException(
          'No se pudo generar la representacion impresa del comprobante',
        );
      }
      if (sale.billingDocumentId && sale.billingEnvironment) {
        try {
          return await this.downloadArtifact(empresaId, sale, type);
        } catch (error) {
          if (!(error instanceof BillingApiError) || error.status !== 404) {
            throw error;
          }
        }
      }
      await delay(350);
    }

    throw new ServiceUnavailableException(
      'El PDF se esta preparando. Intentalo nuevamente en unos segundos',
    );
  }

  private async downloadArtifact(
    empresaId: bigint,
    sale: {
      billingDocumentId: string | null;
      billingEnvironment: BillingEnvironment | null;
    },
    type: 'XML' | 'CDR' | 'PDF_A4' | 'PDF_TICKET',
  ) {
    if (!sale.billingDocumentId || !sale.billingEnvironment) {
      throw new NotFoundException('El comprobante aun no tiene artefactos');
    }
    const apiKey = await this.integration.apiKey(
      empresaId,
      sale.billingEnvironment,
    );
    const descriptor = await this.api.application<ArtifactDescriptor>(
      `/documents/${sale.billingDocumentId}/artifacts/${type}`,
      apiKey,
    );
    const file = await this.api.download(descriptor.url);
    if (file.bytes.length !== descriptor.sizeBytes) {
      throw new BadRequestException(
        'El artefacto Billing tiene tamano invalido',
      );
    }
    const digest = createHash('sha256').update(file.bytes).digest('hex');
    if (digest !== descriptor.sha256) {
      throw new BadRequestException(
        'El artefacto Billing no supero integridad',
      );
    }
    return {
      buffer: file.bytes,
      filename: descriptor.fileName,
      contentType: descriptor.contentType || file.contentType,
    };
  }

  async applyDocument(ventaId: bigint, document: BillingDocument) {
    const status = normalizeStatus(document.status);
    const updatedAt = document.updatedAt
      ? new Date(document.updatedAt)
      : new Date();
    const sale = await this.prisma.venta.findUnique({
      where: { id: ventaId },
      select: { billingUpdatedAt: true },
    });
    if (sale?.billingUpdatedAt && sale.billingUpdatedAt > updatedAt) return;
    await this.prisma.venta.update({
      where: { id: ventaId },
      data: {
        billingDocumentId: document.id,
        billingEnvironment: document.environment,
        billingStatus: status,
        billingUpdatedAt: updatedAt,
        serie: document.series,
        numero: document.number,
        correlativo:
          document.fullNumber ??
          `${document.series}-${String(document.number).padStart(8, '0')}`,
        sunatEstado: sunatStatus(status),
        sunatCodigo: document.sunat?.code ?? null,
        sunatMensaje: document.sunat?.message ?? null,
        billingSunatObservations:
          document.sunat?.observations ?? Prisma.JsonNull,
        sunatEnviadoAt: dateOrNull(document.sunat?.submittedAt),
        sunatRespondidoAt: dateOrNull(document.sunat?.respondedAt),
        billingLastError:
          status === 'FAILED' || status === 'REJECTED'
            ? (document.sunat?.message ??
              'Billing no pudo emitir el comprobante')
            : null,
      },
    });
  }

  private async process(id: string) {
    const claimed = await this.prisma.billingOutbox.updateMany({
      where: { id, status: { in: ['PENDING', 'RETRY'] } },
      data: {
        status: 'PROCESSING',
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) return;
    const job = await this.prisma.billingOutbox.findUniqueOrThrow({
      where: { id },
    });
    if (job.operation === 'VOID') {
      try {
        await this.voids.processOutboxJob(job);
        await this.prisma.billingOutbox.update({
          where: { id },
          data: {
            status: 'DONE',
            lockedAt: null,
            processedAt: new Date(),
            lastError: null,
          },
        });
      } catch (error) {
        await this.voids.handleOutboxFailure(job, error);
      }
      return;
    }
    try {
      const sale = await this.saleForEmission(job.ventaId, job.environment);
      const issueDate = limaDate(sale.createdAt);
      if (
        sale.tipoComprobante === VentaTipoComprobante.factura &&
        calendarDayDifference(issueDate, limaDate(new Date())) > 1
      ) {
        throw new BillingApiError(
          'La factura excedio el plazo de envio: debe remitirse el mismo dia o el dia calendario siguiente',
          422,
          null,
        );
      }
      const apiKey = await this.integration.apiKey(
        job.empresaId,
        job.environment,
      );
      const document = await this.api.application<BillingDocument>(
        '/documents',
        apiKey,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': job.idempotencyKey },
          body: JSON.stringify(this.payload(sale, job.environment)),
        },
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.billingOutbox.update({
          where: { id },
          data: {
            status: 'DONE',
            lockedAt: null,
            processedAt: new Date(),
            lastError: null,
          },
        });
      });
      await this.applyDocument(sale.id, document);
    } catch (error) {
      const retryable =
        error instanceof BillingApiError ? error.retryable : true;
      const dead = !retryable || job.attempts >= job.maxAttempts;
      const delay = Math.min(
        15 * 60_000,
        10_000 * 2 ** Math.min(job.attempts, 6),
      );
      await this.prisma.$transaction([
        this.prisma.billingOutbox.update({
          where: { id },
          data: {
            status: dead ? 'DEAD' : 'RETRY',
            lockedAt: null,
            lastError: safeMessage(error),
            nextAttemptAt: new Date(Date.now() + delay),
          },
        }),
        this.prisma.venta.update({
          where: { id: job.ventaId },
          data: {
            billingStatus: dead ? 'FAILED' : 'RETRY_SCHEDULED',
            billingLastError: safeMessage(error),
            billingAttempts: { increment: 1 },
            billingUpdatedAt: new Date(),
            sunatEstado: dead ? 'error_definitivo' : 'error_transitorio',
          },
        }),
      ]);
    }
  }

  private saleForEmission(ventaId: bigint, environment: BillingEnvironment) {
    return this.prisma.venta.findFirstOrThrow({
      where: { id: ventaId, billingEnvironment: environment },
      include: {
        empresa: { include: { billingIntegration: true } },
        sucursal: {
          include: { billingEstablishments: { where: { environment } } },
        },
        cliente: true,
        serieComprobante: {
          include: { billingSeries: { where: { environment } } },
        },
        detalles: { include: { productoVariante: true } },
        pagos: true,
        cuentaPorCobrar: {
          include: { cuotas: { orderBy: { numero: 'asc' } } },
        },
      },
    });
  }

  private payload(
    sale: Awaited<ReturnType<typeof this.saleForEmission>>,
    environment: BillingEnvironment,
  ) {
    const establishment = sale.sucursal?.billingEstablishments[0];
    const fiscalSeries = sale.serieComprobante.billingSeries[0];
    if (!establishment || !fiscalSeries) {
      throw new BadRequestException(
        'La sucursal o serie no esta sincronizada con Billing',
      );
    }
    const credit = sale.formaPago === VentaFormaPago.CREDITO;
    const amountDue = sale.cuentaPorCobrar?.saldoInicial ?? sale.total;
    return {
      documentType:
        sale.tipoComprobante === VentaTipoComprobante.boleta
          ? 'RECEIPT'
          : 'INVOICE',
      externalId: sale.publicId,
      series: sale.serie,
      issueDate: limaDate(sale.createdAt),
      issueTime: limaTime(sale.createdAt),
      establishmentCode: establishment.code,
      currency: sale.moneda,
      taxRate: sale.igvPorcentaje.toFixed(2),
      customer: customer(sale),
      paymentTerms: credit
        ? {
            method: 'CREDIT',
            amountDue: amountDue.toFixed(2),
            installments: (sale.cuentaPorCobrar?.cuotas ?? []).map((item) => ({
              number: item.numero,
              amount: item.montoOriginal.toFixed(2),
              dueDate: item.fechaVencimiento.toISOString().slice(0, 10),
            })),
          }
        : { method: 'CASH' },
      globalDiscount: discount(sale.descuentoTipo, sale.descuentoValor),
      lines: sale.detalles.map((line) => ({
        externalId: line.id.toString(),
        sku: line.productoVariante.sku,
        description: line.descripcion || 'Producto',
        quantity: line.cantidad.toString(),
        unitCode: line.unidadMedidaCodigo,
        unitPrice: line.precioUnitario.toFixed(2),
        unitPriceIncludesTax: true,
        taxAffectationCode: line.tipoAfectacionIgvCodigo,
        discount: discount(line.descuentoTipo, line.descuentoValor),
      })),
      expectedTotals: {
        taxable: sale.opGravadas.toFixed(2),
        exempt: sale.opExoneradas.toFixed(2),
        unaffected: sale.opInafectas.toFixed(2),
        tax: sale.igvMonto.toFixed(2),
        total: sale.total.toFixed(2),
      },
      notes: sale.observaciones,
      metadata: {
        nuvexCompanyId: sale.empresaId.toString(),
        nuvexBranchId: sale.sucursalId?.toString() ?? null,
        nuvexSaleId: sale.publicId,
        environment,
      },
    };
  }
}

function customer(
  sale: Awaited<ReturnType<BillingEmissionService['saleForEmission']>>,
) {
  const client = sale.cliente;
  if (!client) return { documentType: 'NONE', name: 'CLIENTE FINAL' };
  return {
    documentType:
      client.tipoDocumento === 'dni'
        ? 'DNI'
        : client.tipoDocumento === 'ruc'
          ? 'RUC'
          : 'NONE',
    documentNumber: client.numeroDocumento,
    name: client.razonSocial || client.nombre || 'CLIENTE FINAL',
    address: client.direccion,
    email: client.email,
  };
}

function discount(type: string | null, value: Prisma.Decimal | null) {
  if (!type || !value || value.lte(0)) return undefined;
  return {
    kind: type === 'porcentaje' ? 'PERCENTAGE' : 'AMOUNT',
    value: value.toString(),
  };
}

function normalizeStatus(
  status: BillingDocument['status'],
): BillingDocumentStatus {
  if (status === 'RECEIVED' || status === 'VALIDATING') return 'QUEUED';
  return status;
}

function accepted(status: BillingDocumentStatus | null) {
  return status === 'ACCEPTED' || status === 'ACCEPTED_WITH_OBSERVATIONS';
}

function sunatStatus(status: BillingDocumentStatus): SunatEstado {
  const map: Record<BillingDocumentStatus, SunatEstado> = {
    QUEUED: 'pendiente_envio',
    PROCESSING: 'enviando',
    ACCEPTED: 'aceptado',
    ACCEPTED_WITH_OBSERVATIONS: 'observado',
    REJECTED: 'rechazado',
    RETRY_SCHEDULED: 'error_transitorio',
    FAILED: 'error_definitivo',
  };
  return map[status];
}

function dateOrNull(value?: string | null) {
  return value ? new Date(value) : null;
}

function limaDate(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function limaTime(value: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1000,
  );
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function calendarDayDifference(from: string, to: string) {
  const fromUtc = Date.parse(`${from}T00:00:00Z`);
  const toUtc = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((toUtc - fromUtc) / 86_400_000);
}
