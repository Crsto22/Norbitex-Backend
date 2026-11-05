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
  CuentaPorCobrarCuotaEstado,
  CuentaPorCobrarEstado,
  SunatEstado,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BillingApiClientService,
  BillingApiError,
} from './billing-api-client.service';
import { BillingIntegrationService } from './billing-integration.service';

export type BillingDebitNoteDocument = {
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
export class BillingDebitNoteService {
  private readonly logger = new Logger(BillingDebitNoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: BillingApiClientService,
    private readonly integration: BillingIntegrationService,
  ) {}

  @Cron('* * * * * *')
  async processOutbox() {
    const jobs = await this.prisma.billingDebitNoteOutbox.findMany({
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
          `Billing debit note ${job.id}: ${safeMessage(error)}`,
        );
      }
    }
  }

  @Cron('55 */5 * * * *')
  async reconcilePending() {
    const notes = await this.prisma.notaDebito.findMany({
      where: {
        billingDocumentId: { not: null },
        billingStatus: { in: ['QUEUED', 'PROCESSING', 'RETRY_SCHEDULED'] },
        billingUpdatedAt: { lt: new Date(Date.now() - 5 * 60_000) },
      },
      select: {
        id: true,
        empresaId: true,
        billingDocumentId: true,
        billingEnvironment: true,
      },
      take: 50,
    });
    for (const note of notes) {
      if (!note.billingDocumentId) continue;
      try {
        const apiKey = await this.integration.apiKey(
          note.empresaId,
          note.billingEnvironment,
        );
        const document = await this.api.application<BillingDebitNoteDocument>(
          `/documents/${note.billingDocumentId}`,
          apiKey,
        );
        await this.applyDocument(note.id, document);
      } catch (error) {
        this.logger.warn(
          `No se pudo conciliar nota de debito ${note.id}: ${safeMessage(error)}`,
        );
      }
    }
  }

  async retry(empresaId: bigint, publicId: string) {
    const note = await this.prisma.notaDebito.findFirst({
      where: { empresaId, publicId },
    });
    if (!note) throw new NotFoundException('Nota de debito no encontrada');
    if (note.billingDocumentId) {
      const apiKey = await this.integration.apiKey(
        empresaId,
        note.billingEnvironment,
      );
      const document = await this.api.application<BillingDebitNoteDocument>(
        `/documents/${note.billingDocumentId}/retry`,
        apiKey,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': `nuvex:${note.billingEnvironment.toLowerCase()}:debit-note:${note.publicId}:retry:${note.billingAttempts + 1}`,
          },
        },
      );
      await this.applyDocument(note.id, document);
      return { status: document.status };
    }
    await this.prisma.$transaction([
      this.prisma.billingDebitNoteOutbox.updateMany({
        where: { notaDebitoId: note.id },
        data: {
          status: 'PENDING',
          nextAttemptAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      }),
      this.prisma.notaDebito.update({
        where: { id: note.id },
        data: {
          billingStatus: 'QUEUED',
          billingLastError: null,
          billingUpdatedAt: new Date(),
          sunatEstado: 'pendiente_envio',
        },
      }),
    ]);
    return { status: 'QUEUED' };
  }

  async artifact(
    empresaId: bigint,
    publicId: string,
    type: 'XML' | 'CDR' | 'PDF_A4' | 'PDF_TICKET',
  ) {
    const printable = type === 'PDF_A4' || type === 'PDF_TICKET';
    let note = await this.prisma.notaDebito.findFirst({
      where: { empresaId, publicId },
      select: {
        id: true,
        billingDocumentId: true,
        billingEnvironment: true,
        billingStatus: true,
      },
    });
    if (!note) throw new NotFoundException('Nota de debito no encontrada');

    if (!printable) {
      if (!note.billingDocumentId) {
        throw new NotFoundException('La nota aun no tiene artefactos Billing');
      }
      if (!accepted(note.billingStatus)) {
        throw new BadRequestException(
          'Los archivos estaran disponibles cuando SUNAT acepte la nota',
        );
      }
      return this.downloadArtifact(empresaId, note, type);
    }

    if (!note.billingDocumentId) {
      const pendingJob = await this.prisma.billingDebitNoteOutbox.findFirst({
        where: {
          notaDebitoId: note.id,
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
      note = await this.prisma.notaDebito.findFirst({
        where: { empresaId, publicId },
        select: {
          id: true,
          billingDocumentId: true,
          billingEnvironment: true,
          billingStatus: true,
        },
      });
      if (!note) throw new NotFoundException('Nota de debito no encontrada');
      if (note.billingStatus === 'FAILED') {
        throw new BadRequestException(
          'No se pudo generar la representacion impresa de la nota',
        );
      }
      if (note.billingDocumentId) {
        try {
          return await this.downloadArtifact(empresaId, note, type);
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
    note: {
      billingDocumentId: string | null;
      billingEnvironment: BillingEnvironment;
    },
    type: 'XML' | 'CDR' | 'PDF_A4' | 'PDF_TICKET',
  ) {
    if (!note.billingDocumentId) {
      throw new NotFoundException('La nota aun no tiene artefactos Billing');
    }
    const apiKey = await this.integration.apiKey(
      empresaId,
      note.billingEnvironment,
    );
    const descriptor = await this.api.application<ArtifactDescriptor>(
      `/documents/${note.billingDocumentId}/artifacts/${type}`,
      apiKey,
    );
    const downloaded = await this.api.download(descriptor.url);
    if (downloaded.bytes.length !== descriptor.sizeBytes) {
      throw new BadRequestException(
        'El artefacto Billing tiene tamano invalido',
      );
    }
    const digest = createHash('sha256').update(downloaded.bytes).digest('hex');
    if (digest !== descriptor.sha256) {
      throw new BadRequestException(
        'El artefacto Billing no supero integridad',
      );
    }
    return {
      buffer: downloaded.bytes,
      filename: descriptor.fileName,
      contentType: descriptor.contentType || downloaded.contentType,
    };
  }

  async applyDocument(noteId: bigint, document: BillingDebitNoteDocument) {
    const status = normalizeStatus(document.status);
    const updatedAt = document.updatedAt
      ? new Date(document.updatedAt)
      : new Date();
    const note = await this.prisma.notaDebito.findUnique({
      where: { id: noteId },
      select: {
        billingUpdatedAt: true,
        serieComprobanteId: true,
        sunatEstado: true,
      },
    });
    if (!note || (note.billingUpdatedAt && note.billingUpdatedAt > updatedAt))
      return;
    await this.prisma.$transaction([
      this.prisma.notaDebito.update({
        where: { id: noteId },
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
          sunatEnviadoAt: dateOrNull(document.sunat?.submittedAt),
          sunatRespondidoAt: dateOrNull(document.sunat?.respondedAt),
          billingLastError:
            status === 'FAILED' || status === 'REJECTED'
              ? (document.sunat?.message ?? 'Billing no pudo emitir la nota')
              : null,
        },
      }),
      this.prisma.serieComprobante.updateMany({
        where: {
          id: note.serieComprobanteId,
          numeroActual: { lt: document.number },
        },
        data: { numeroActual: document.number },
      }),
    ]);
    if (accepted(status) && !acceptedSunat(note.sunatEstado)) {
      await this.applyAcceptedEffects(noteId);
    }
  }

  private async process(id: string) {
    const claimed = await this.prisma.billingDebitNoteOutbox.updateMany({
      where: { id, status: { in: ['PENDING', 'RETRY'] } },
      data: {
        status: 'PROCESSING',
        lockedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) return;
    const job = await this.prisma.billingDebitNoteOutbox.findUniqueOrThrow({
      where: { id },
    });
    try {
      const note = await this.noteForEmission(
        job.notaDebitoId,
        job.environment,
      );
      const apiKey = await this.integration.apiKey(
        job.empresaId,
        job.environment,
      );
      const document = await this.api.application<BillingDebitNoteDocument>(
        '/debit-notes',
        apiKey,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': job.idempotencyKey },
          body: JSON.stringify(this.payload(note)),
        },
      );
      await this.applyDocument(note.id, document);
      await this.prisma.billingDebitNoteOutbox.update({
        where: { id },
        data: {
          status: 'DONE',
          lockedAt: null,
          processedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      const retryable =
        error instanceof BillingApiError ? error.retryable : true;
      const dead = !retryable || job.attempts >= job.maxAttempts;
      const delay = Math.min(
        15 * 60_000,
        10_000 * 2 ** Math.min(job.attempts, 6),
      );
      await this.prisma.$transaction([
        this.prisma.billingDebitNoteOutbox.update({
          where: { id },
          data: {
            status: dead ? 'DEAD' : 'RETRY',
            lockedAt: null,
            lastError: safeMessage(error),
            nextAttemptAt: new Date(Date.now() + delay),
          },
        }),
        this.prisma.notaDebito.update({
          where: { id: job.notaDebitoId },
          data: {
            billingStatus: dead ? 'FAILED' : 'RETRY_SCHEDULED',
            billingLastError: safeMessage(error),
            billingAttempts: { increment: 1 },
            billingUpdatedAt: new Date(),
            sunatEstado: dead ? 'error_definitivo' : 'error_transitorio',
            sunatMensaje: safeMessage(error).slice(0, 500),
          },
        }),
      ]);
    }
  }

  private noteForEmission(noteId: bigint, environment: BillingEnvironment) {
    return this.prisma.notaDebito.findFirstOrThrow({
      where: { id: noteId, billingEnvironment: environment },
      include: {
        ventaReferencia: { include: { detalles: { orderBy: { id: 'asc' } } } },
        cliente: true,
        sucursal: {
          include: { billingEstablishments: { where: { environment } } },
        },
        serieComprobante: {
          include: { billingSeries: { where: { environment } } },
        },
        detalles: { orderBy: { id: 'asc' } },
      },
    });
  }

  private payload(
    note: Awaited<ReturnType<BillingDebitNoteService['noteForEmission']>>,
  ) {
    if (!note.ventaReferencia.billingDocumentId) {
      throw new BadRequestException(
        'El comprobante original no pertenece a Billing',
      );
    }
    if (!note.sucursal?.billingEstablishments[0]) {
      throw new BadRequestException(
        'La sucursal no esta sincronizada con Billing',
      );
    }
    if (!note.serieComprobante.billingSeries[0]) {
      throw new BadRequestException(
        'La serie no esta sincronizada con Billing',
      );
    }
    const sourceLines = new Map(
      note.ventaReferencia.detalles.map((line, index) => [
        line.id.toString(),
        index + 1,
      ]),
    );
    return {
      externalId: `debit-note:${note.publicId}`,
      referenceDocumentId: note.ventaReferencia.billingDocumentId,
      series: note.serie,
      issueDate: limaDate(note.createdAt),
      currency: note.moneda,
      reasonCode: note.codigoMotivo,
      reasonDescription: note.descripcionMotivo,
      customer: {
        documentType:
          note.cliente.tipoDocumento === 'dni'
            ? 'DNI'
            : note.cliente.tipoDocumento === 'ruc'
              ? 'RUC'
              : 'NONE',
        documentNumber: note.cliente.numeroDocumento,
      },
      adjustments: note.detalles.map((line) => {
        const referenceLineNumber = sourceLines.get(
          line.ventaDetalleReferenciaId.toString(),
        );
        if (!referenceLineNumber) {
          throw new BadRequestException(
            'La nota contiene una linea sin referencia original',
          );
        }
        return {
          referenceLineNumber,
          amount: line.importe.toFixed(2),
          description: line.descripcion,
        };
      }),
    };
  }

  private async applyAcceptedEffects(noteId: bigint) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "nota_debito" WHERE "id" = ${noteId} FOR UPDATE`;
      const note = await tx.notaDebito.findUnique({
        where: { id: noteId },
        include: {
          ventaReferencia: {
            include: { cuentaPorCobrar: { include: { cuotas: true } } },
          },
        },
      });
      if (!note || note.commercialEffectsApplied) return;
      const sale = note.ventaReferencia;
      const account = sale.cuentaPorCobrar;
      if (account) {
        const nextNumber =
          account.cuotas.reduce((max, item) => Math.max(max, item.numero), 0) +
          1;
        await tx.cuentaPorCobrarCuota.create({
          data: {
            cuentaPorCobrarId: account.id,
            numero: nextNumber,
            fechaVencimiento: note.fechaVencimiento,
            montoOriginal: note.total,
            saldo: note.total,
            estado: CuentaPorCobrarCuotaEstado.pendiente,
          },
        });
        await tx.cuentaPorCobrar.update({
          where: { id: account.id },
          data: {
            totalVenta: { increment: note.total },
            saldoInicial: { increment: note.total },
            saldoPendiente: { increment: note.total },
            estado: account.adelanto.gt(0)
              ? CuentaPorCobrarEstado.parcial
              : CuentaPorCobrarEstado.pendiente,
          },
        });
      } else {
        await tx.cuentaPorCobrar.create({
          data: {
            empresaId: note.empresaId,
            ventaId: sale.id,
            clienteId: note.clienteId,
            sucursalId: note.sucursalId,
            moneda: note.moneda,
            totalVenta: sale.total.add(note.total),
            adelanto: sale.total,
            saldoInicial: note.total,
            saldoPendiente: note.total,
            estado: CuentaPorCobrarEstado.parcial,
            primerVencimiento: note.fechaVencimiento,
            cuotas: {
              create: {
                numero: 1,
                fechaVencimiento: note.fechaVencimiento,
                montoOriginal: note.total,
                saldo: note.total,
                estado: CuentaPorCobrarCuotaEstado.pendiente,
              },
            },
          },
        });
      }
      await tx.notaDebito.update({
        where: { id: note.id },
        data: { commercialEffectsApplied: true },
      });
    });
  }
}

function normalizeStatus(
  status: BillingDebitNoteDocument['status'],
): BillingDocumentStatus {
  return status === 'RECEIVED' || status === 'VALIDATING' ? 'QUEUED' : status;
}
function accepted(status: BillingDocumentStatus | null) {
  return status === 'ACCEPTED' || status === 'ACCEPTED_WITH_OBSERVATIONS';
}
function acceptedSunat(status: SunatEstado) {
  return status === 'aceptado' || status === 'observado';
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
function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1000,
  );
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
