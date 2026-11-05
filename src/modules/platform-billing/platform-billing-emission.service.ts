import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  BillingDocumentStatus,
  BillingEnvironment,
  PlataformaComprobanteEstado,
  PlataformaComprobanteTipo,
  Prisma,
  SunatBajaEstado,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BillingApiClientService,
  BillingApiError,
} from '../billing-integration/billing-api-client.service';
import { PlatformBillingIntegrationService } from './platform-billing-integration.service';
import { PlatformBillingService } from './platform-billing.service';

export type PlatformBillingDocument = {
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

export type PlatformVoidRequest = {
  id: string;
  environment: BillingEnvironment;
  status:
    | 'PENDING'
    | 'SUBMITTED'
    | 'PROCESSING'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'FAILED';
  procedure: 'VOIDED_DOCUMENTS' | 'DAILY_SUMMARY';
  ticket?: string | null;
  updatedAt?: string;
  sunat?: { code?: string | null; message?: string | null };
  resource: { externalId: string };
};

const platformReceiptInclude = {
  detalles: true,
  empresa: true,
  serieConfiguracion: { include: { billingMappings: true } },
  comprobanteOrigen: true,
} satisfies Prisma.ComprobantePlataformaInclude;

type PlatformReceipt = Prisma.ComprobantePlataformaGetPayload<{
  include: typeof platformReceiptInclude;
}>;

@Injectable()
export class PlatformBillingEmissionService {
  private readonly logger = new Logger(PlatformBillingEmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: BillingApiClientService,
    private readonly integration: PlatformBillingIntegrationService,
    private readonly platformBilling: PlatformBillingService,
  ) {}

  @Cron('5/10 * * * * *')
  async processOutbox() {
    const jobs = await this.prisma.platformBillingOutbox.findMany({
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
        this.logger.error(`Platform Billing ${job.id}: ${safeMessage(error)}`);
      }
    }
  }

  @Cron('45 */5 * * * *')
  async reconcile() {
    const rows = await this.prisma.comprobantePlataforma.findMany({
      where: {
        billingEnvironment: { not: null },
        billingUpdatedAt: { lt: new Date(Date.now() - 5 * 60_000) },
        OR: [
          {
            billingDocumentId: { not: null },
            billingStatus: {
              in: ['QUEUED', 'PROCESSING', 'RETRY_SCHEDULED'],
            },
          },
          {
            billingVoidRequestId: { not: null },
            sunatBajaEstado: { in: ['pendiente_envio', 'pendiente_cdr'] },
          },
        ],
      },
      take: 50,
    });
    for (const receipt of rows) {
      try {
        const apiKey = await this.integration.apiKey(
          receipt.billingEnvironment!,
        );
        if (receipt.billingVoidRequestId) {
          const request = await this.api.application<PlatformVoidRequest>(
            `/void-requests/${receipt.billingVoidRequestId}`,
            apiKey,
          );
          await this.applyVoid(receipt.id, request);
        } else if (receipt.billingDocumentId) {
          const document = await this.api.application<PlatformBillingDocument>(
            `/documents/${receipt.billingDocumentId}`,
            apiKey,
          );
          await this.applyDocument(receipt.id, document);
        }
      } catch (error) {
        this.logger.warn(
          `No se pudo conciliar comprobante ${receipt.id}: ${safeMessage(error)}`,
        );
      }
    }
  }

  async applyDocument(receiptId: bigint, document: PlatformBillingDocument) {
    const status = normalizeStatus(document.status);
    const updatedAt = document.updatedAt
      ? new Date(document.updatedAt)
      : new Date();
    const current = await this.prisma.comprobantePlataforma.findUnique({
      where: { id: receiptId },
      select: { billingUpdatedAt: true, tipo: true, serieId: true },
    });
    if (!current) return;
    if (current.billingUpdatedAt && current.billingUpdatedAt > updatedAt)
      return;
    await this.prisma.$transaction(async (tx) => {
      await tx.comprobantePlataforma.update({
        where: { id: receiptId },
        data: {
          billingDocumentId: document.id,
          billingEnvironment: document.environment,
          billingStatus: status,
          billingUpdatedAt: updatedAt,
          billingLastError:
            status === 'FAILED' || status === 'REJECTED'
              ? document.sunat?.message || 'Billing rechazo el comprobante'
              : null,
          serie: document.series,
          numero: document.number,
          estado: localStatus(status),
          sunatCodigo: document.sunat?.code ?? null,
          sunatMensaje: document.sunat?.message ?? null,
        },
      });
      await tx.serieComprobantePlataforma.updateMany({
        where: { id: current.serieId, correlativo: { lt: document.number } },
        data: { correlativo: document.number },
      });
    });
    if (
      current.tipo === PlataformaComprobanteTipo.nota_credito &&
      accepted(status)
    ) {
      await this.platformBilling.finalizeAcceptedCreditNote(receiptId);
    }
  }

  async applyVoid(receiptId: bigint, request: PlatformVoidRequest) {
    const updatedAt = request.updatedAt
      ? new Date(request.updatedAt)
      : new Date();
    const current = await this.prisma.comprobantePlataforma.findUnique({
      where: { id: receiptId },
      select: { billingUpdatedAt: true },
    });
    if (!current) return;
    if (current.billingUpdatedAt && current.billingUpdatedAt > updatedAt)
      return;
    const state = voidStatus(request.status);
    await this.prisma.comprobantePlataforma.update({
      where: { id: receiptId },
      data: {
        billingVoidRequestId: request.id,
        billingUpdatedAt: updatedAt,
        sunatBajaEstado: state,
        sunatBajaCodigo: request.sunat?.code ?? null,
        sunatBajaMensaje: request.sunat?.message ?? null,
        sunatBajaTicket: request.ticket ?? null,
        sunatBajaRespondidaAt: terminalVoid(request.status) ? updatedAt : null,
      },
    });
    if (request.status === 'ACCEPTED') {
      await this.platformBilling.finalizeAcceptedCancellation(receiptId);
    }
  }

  private async process(id: string) {
    const claimed = await this.prisma.platformBillingOutbox.updateMany({
      where: { id, status: { in: ['PENDING', 'RETRY'] } },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        lockedAt: new Date(),
      },
    });
    if (!claimed.count) return;
    const job = await this.prisma.platformBillingOutbox.findUniqueOrThrow({
      where: { id },
    });
    try {
      if (job.operation === 'VOID') {
        await this.processVoid(
          job.receiptId,
          job.environment,
          job.idempotencyKey,
        );
      } else {
        await this.processIssue(
          job.receiptId,
          job.environment,
          job.idempotencyKey,
        );
      }
      await this.prisma.platformBillingOutbox.update({
        where: { id },
        data: {
          status: 'DONE',
          lockedAt: null,
          lastError: null,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      await this.fail(job, error);
    }
  }

  private async processIssue(
    receiptId: bigint,
    environment: BillingEnvironment,
    idempotencyKey: string,
  ) {
    const receipt = await this.receipt(receiptId, environment);
    const apiKey = await this.integration.apiKey(environment);
    const document = receipt.billingDocumentId
      ? await this.api.application<PlatformBillingDocument>(
          `/documents/${receipt.billingDocumentId}/retry`,
          apiKey,
          {
            method: 'POST',
            headers: {
              'Idempotency-Key': `${idempotencyKey}:retry:${receipt.billingAttempts}`,
            },
          },
        )
      : receipt.tipo === PlataformaComprobanteTipo.nota_credito
        ? await this.api.application<PlatformBillingDocument>(
            '/credit-notes',
            apiKey,
            {
              method: 'POST',
              headers: { 'Idempotency-Key': idempotencyKey },
              body: JSON.stringify(this.creditNotePayload(receipt)),
            },
          )
        : await this.api.application<PlatformBillingDocument>(
            '/documents',
            apiKey,
            {
              method: 'POST',
              headers: { 'Idempotency-Key': idempotencyKey },
              body: JSON.stringify(this.documentPayload(receipt)),
            },
          );
    await this.applyDocument(receipt.id, document);
  }

  private async processVoid(
    receiptId: bigint,
    environment: BillingEnvironment,
    idempotencyKey: string,
  ) {
    const receipt = await this.receipt(receiptId, environment);
    if (!receipt.billingDocumentId) {
      throw new BadRequestException(
        'El comprobante no tiene documento Billing',
      );
    }
    const apiKey = await this.integration.apiKey(environment);
    let request: PlatformVoidRequest;
    if (receipt.billingVoidRequestId) {
      request = await this.api.application<PlatformVoidRequest>(
        `/void-requests/${receipt.billingVoidRequestId}`,
        apiKey,
      );
      if (request.status === 'FAILED' || request.status === 'REJECTED') {
        request = await this.api.application<PlatformVoidRequest>(
          `/void-requests/${receipt.billingVoidRequestId}/retry`,
          apiKey,
          {
            method: 'POST',
            headers: {
              'Idempotency-Key': `${idempotencyKey}:retry:${receipt.billingAttempts}`,
            },
          },
        );
      }
    } else {
      request = await this.api.application<PlatformVoidRequest>(
        `/documents/${receipt.billingDocumentId}/void`,
        apiKey,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({
            reason: receipt.sunatBajaMotivo,
            documentDelivered: false,
          }),
        },
      );
      await this.prisma.comprobantePlataforma.update({
        where: { id: receipt.id },
        data: { billingVoidRequestId: request.id },
      });
    }
    await this.api.application(`/void-requests/${request.id}/submit`, apiKey, {
      method: 'POST',
    });
    await this.applyVoid(receipt.id, request);
  }

  private receipt(receiptId: bigint, environment: BillingEnvironment) {
    return this.prisma.comprobantePlataforma.findFirstOrThrow({
      where: { id: receiptId, billingEnvironment: environment },
      include: platformReceiptInclude,
    });
  }

  private documentPayload(receipt: PlatformReceipt) {
    const documentType =
      receipt.tipo === PlataformaComprobanteTipo.factura
        ? 'INVOICE'
        : 'RECEIPT';
    return {
      documentType,
      externalId: `platform:${receipt.requestId}`,
      series: receipt.serie,
      establishmentCode: '0000',
      issueDate: limaDate(receipt.fechaEmision),
      issueTime: limaTime(receipt.fechaEmision),
      currency: receipt.moneda,
      taxRate:
        Number(receipt.baseImponible) > 0
          ? (
              (Number(receipt.igv) / Number(receipt.baseImponible)) *
              100
            ).toFixed(4)
          : '18',
      customer: {
        documentType: customerType(receipt.receptorTipoDocumento),
        documentNumber: receipt.receptorDocumento,
        name: receipt.receptorNombre,
        address: receipt.receptorDireccion,
      },
      paymentTerms: { method: 'CASH' },
      lines: receipt.detalles.map((line) => ({
        externalId: line.id.toString(),
        description: line.descripcion,
        quantity: line.cantidad.toFixed(3),
        unitCode: 'ZZ',
        unitPrice: line.precioUnitario.toFixed(2),
        unitPriceIncludesTax: true,
        taxAffectationCode: '10',
      })),
      expectedTotals: {
        taxable: receipt.baseImponible.toFixed(2),
        exempt: '0.00',
        unaffected: '0.00',
        tax: receipt.igv.toFixed(2),
        total: receipt.total.toFixed(2),
      },
      metadata: {
        source: 'NUVEX_PLATFORM',
        companyId: receipt.empresaId.toString(),
        receiptId: receipt.id.toString(),
      },
    };
  }

  private creditNotePayload(receipt: PlatformReceipt) {
    if (!receipt.comprobanteOrigen?.billingDocumentId) {
      throw new BadRequestException(
        'La nota de credito requiere un comprobante Billing de origen',
      );
    }
    return {
      externalId: `platform:${receipt.requestId}`,
      referenceDocumentId: receipt.comprobanteOrigen.billingDocumentId,
      series: receipt.serie,
      issueDate: limaDate(receipt.fechaEmision),
      currency: receipt.moneda,
      reasonCode: '01',
      reasonDescription: receipt.motivoNotaCredito || 'Anulacion de operacion',
      customer: {
        documentType: customerType(receipt.receptorTipoDocumento),
        documentNumber: receipt.receptorDocumento,
      },
      adjustments: receipt.detalles.map((line, index) => ({
        referenceLineNumber: index + 1,
        amount: line.total.toFixed(2),
        description: line.descripcion,
      })),
    };
  }

  private async fail(
    job: {
      id: string;
      receiptId: bigint;
      attempts: number;
      maxAttempts: number;
    },
    error: unknown,
  ) {
    const retryable = error instanceof BillingApiError ? error.retryable : true;
    const dead = !retryable || job.attempts >= job.maxAttempts;
    const message = safeMessage(error);
    const delay = Math.min(
      15 * 60_000,
      10_000 * 2 ** Math.min(job.attempts, 6),
    );
    await this.prisma.$transaction([
      this.prisma.platformBillingOutbox.update({
        where: { id: job.id },
        data: {
          status: dead ? 'DEAD' : 'RETRY',
          lockedAt: null,
          lastError: message,
          nextAttemptAt: new Date(Date.now() + delay),
        },
      }),
      this.prisma.comprobantePlataforma.update({
        where: { id: job.receiptId },
        data: {
          billingStatus: dead ? 'FAILED' : 'RETRY_SCHEDULED',
          billingLastError: message,
          billingAttempts: { increment: 1 },
          billingUpdatedAt: new Date(),
          estado: dead
            ? PlataformaComprobanteEstado.error
            : PlataformaComprobanteEstado.pendiente,
        },
      }),
    ]);
  }
}

function normalizeStatus(
  value: PlatformBillingDocument['status'],
): BillingDocumentStatus {
  if (value === 'RECEIVED' || value === 'VALIDATING') return 'QUEUED';
  return value;
}

function localStatus(status: BillingDocumentStatus) {
  if (accepted(status)) return PlataformaComprobanteEstado.aceptado;
  if (status === 'REJECTED') return PlataformaComprobanteEstado.rechazado;
  if (status === 'FAILED') return PlataformaComprobanteEstado.error;
  return PlataformaComprobanteEstado.pendiente;
}

function accepted(status: BillingDocumentStatus) {
  return status === 'ACCEPTED' || status === 'ACCEPTED_WITH_OBSERVATIONS';
}

function voidStatus(status: PlatformVoidRequest['status']) {
  if (status === 'ACCEPTED') return SunatBajaEstado.aceptado;
  if (status === 'REJECTED') return SunatBajaEstado.rechazado;
  if (status === 'FAILED') return SunatBajaEstado.error_definitivo;
  if (status === 'SUBMITTED' || status === 'PROCESSING') {
    return SunatBajaEstado.pendiente_cdr;
  }
  return SunatBajaEstado.pendiente_envio;
}

function terminalVoid(status: PlatformVoidRequest['status']) {
  return ['ACCEPTED', 'REJECTED', 'FAILED'].includes(status);
}

function customerType(code: string | null) {
  if (code === '6') return 'RUC';
  if (code === '1') return 'DNI';
  return 'NONE';
}

function limaParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function limaDate(value: Date) {
  const part = limaParts(value);
  return `${part.year}-${part.month}-${part.day}`;
}

function limaTime(value: Date) {
  const part = limaParts(value);
  return `${part.hour}:${part.minute}:${part.second}`;
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1000,
  );
}
