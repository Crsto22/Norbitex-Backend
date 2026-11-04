import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  BillingEnvironment,
  BillingOutboxStatus,
  CajaMovimientoTipo,
  CajaSesionEstado,
  CuentaPorCobrarEstado,
  Prisma,
  StockMovimientoTipo,
  SunatBajaEstado,
  SunatBajaTipo,
  VentaEstado,
  VentaTipoComprobante,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import {
  BillingApiClientService,
  BillingApiError,
} from './billing-api-client.service';
import { BillingIntegrationService } from './billing-integration.service';

export type BillingVoidRequest = {
  id: string;
  status:
    | 'PENDING'
    | 'SUBMITTED'
    | 'PROCESSING'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'FAILED';
  procedure: 'VOIDED_DOCUMENTS' | 'DAILY_SUMMARY';
  environment: BillingEnvironment;
  resource: { id: string; externalId: string; fullNumber?: string };
  ticket?: string | null;
  sunat?: {
    code?: string | null;
    message?: string | null;
    submittedAt?: string | null;
    respondedAt?: string | null;
  };
  updatedAt?: string;
  createdAt?: string;
};

type BillingVoidArtifact = {
  fileName: string;
  url: string;
  contentType?: string;
};

@Injectable()
export class BillingVoidService {
  private readonly logger = new Logger(BillingVoidService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: BillingApiClientService,
    private readonly integration: BillingIntegrationService,
    private readonly stock: StockService,
  ) {}

  async request(
    empresaId: bigint,
    publicId: string,
    reason: string,
    documentDelivered: boolean | undefined,
  ) {
    const sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      include: { empresa: { include: { billingIntegration: true } } },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (!sale.empresa.billingMicroserviceEnabled) {
      throw new BadRequestException('La empresa no utiliza Nuvex Billing');
    }
    if (sale.empresa.billingIntegration?.status !== 'READY') {
      throw new BadRequestException(
        'La integracion con Nuvex Billing no esta lista',
      );
    }
    if (
      sale.tipoComprobante !== VentaTipoComprobante.boleta &&
      sale.tipoComprobante !== VentaTipoComprobante.factura
    ) {
      throw new BadRequestException('La venta no requiere baja SUNAT');
    }
    if (sale.estado !== VentaEstado.completada) {
      throw new BadRequestException(
        'Solo se pueden dar de baja ventas completadas',
      );
    }
    if (!sale.billingDocumentId || !sale.billingEnvironment) {
      throw new BadRequestException(
        'La venta no tiene un documento Billing asociado',
      );
    }
    if (
      !['ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS'].includes(
        sale.billingStatus ?? '',
      )
    ) {
      throw new BadRequestException(
        'Billing debe aceptar el comprobante antes de solicitar la baja',
      );
    }
    if (documentDelivered !== false) {
      throw new BadRequestException(
        'La baja solo procede si el comprobante no fue entregado; si fue entregado corresponde una nota de credito',
      );
    }
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 3 || normalizedReason.length > 100) {
      throw new BadRequestException(
        'El motivo debe tener entre 3 y 100 caracteres',
      );
    }
    if (
      sale.billingVoidRequestId ||
      [
        'pendiente_envio',
        'enviando',
        'pendiente_cdr',
        'aceptado',
        'observado',
      ].includes(sale.sunatBajaEstado ?? '')
    ) {
      throw new BadRequestException(
        'La venta ya tiene una baja SUNAT en proceso o aceptada',
      );
    }

    const idempotencyKey = `nuvex:${sale.billingEnvironment.toLowerCase()}:sale:${sale.publicId}:void`;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.venta.update({
        where: { id: sale.id },
        data: {
          tipoAnulacion: 'SUNAT_BAJA',
          anuladoRazon: normalizedReason,
          sunatBajaEstado: SunatBajaEstado.pendiente_envio,
          sunatBajaCodigo: null,
          sunatBajaMensaje:
            'Solicitud de baja registrada. Pendiente de envio a SUNAT.',
          sunatBajaTicket: null,
          sunatBajaTipo:
            sale.tipoComprobante === VentaTipoComprobante.factura
              ? SunatBajaTipo.RA
              : SunatBajaTipo.RC,
          sunatBajaLoteId: null,
          sunatBajaSolicitadaAt: now,
          sunatBajaRespondidaAt: null,
          billingVoidRequestId: null,
          billingVoidUpdatedAt: now,
        },
      });
      await tx.cuentaPorCobrar.updateMany({
        where: { ventaId: sale.id },
        data: { estado: CuentaPorCobrarEstado.anulacion_pendiente },
      });
      await tx.billingOutbox.upsert({
        where: {
          ventaId_environment_operation: {
            ventaId: sale.id,
            environment: sale.billingEnvironment!,
            operation: 'VOID',
          },
        },
        create: {
          empresaId,
          ventaId: sale.id,
          environment: sale.billingEnvironment!,
          operation: 'VOID',
          idempotencyKey,
        },
        update: {
          status: BillingOutboxStatus.PENDING,
          attempts: 0,
          nextAttemptAt: now,
          lockedAt: null,
          lastError: null,
          processedAt: null,
        },
      });
    });
    return this.publicStatus(empresaId, publicId);
  }

  @Cron('35 */5 * * * *')
  async reconcilePending() {
    const sales = await this.prisma.venta.findMany({
      where: {
        billingVoidRequestId: { not: null },
        sunatBajaEstado: {
          in: [
            'pendiente_envio',
            'enviando',
            'pendiente_cdr',
            'error_transitorio',
          ],
        },
        OR: [
          { billingVoidUpdatedAt: null },
          { billingVoidUpdatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
        ],
      },
      select: {
        id: true,
        empresaId: true,
        billingEnvironment: true,
        billingVoidRequestId: true,
      },
      take: 50,
    });
    for (const sale of sales) {
      if (!sale.billingEnvironment || !sale.billingVoidRequestId) continue;
      try {
        const apiKey = await this.integration.apiKey(
          sale.empresaId,
          sale.billingEnvironment,
        );
        const request = await this.api.application<BillingVoidRequest>(
          `/void-requests/${sale.billingVoidRequestId}`,
          apiKey,
        );
        await this.apply(sale.id, request);
      } catch (error) {
        this.logger.warn(
          `No se pudo conciliar baja de venta ${sale.id}: ${safeMessage(error)}`,
        );
      }
    }
  }

  async processOutboxJob(job: {
    id: string;
    empresaId: bigint;
    ventaId: bigint;
    environment: BillingEnvironment;
    idempotencyKey: string;
    attempts: number;
    maxAttempts: number;
  }) {
    const sale = await this.prisma.venta.findFirstOrThrow({
      where: {
        id: job.ventaId,
        empresaId: job.empresaId,
        billingEnvironment: job.environment,
      },
    });
    if (!sale.billingDocumentId) {
      throw new BillingApiError(
        'La venta no tiene documento Billing',
        422,
        null,
      );
    }
    const apiKey = await this.integration.apiKey(
      job.empresaId,
      job.environment,
    );
    let request: BillingVoidRequest;
    if (sale.billingVoidRequestId) {
      request = await this.api.application<BillingVoidRequest>(
        `/void-requests/${sale.billingVoidRequestId}`,
        apiKey,
      );
    } else {
      request = await this.api.application<BillingVoidRequest>(
        `/documents/${sale.billingDocumentId}/void`,
        apiKey,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': job.idempotencyKey },
          body: JSON.stringify({
            reason: sale.anuladoRazon,
            documentDelivered: false,
          }),
        },
      );
      await this.apply(sale.id, request);
    }
    if (!['ACCEPTED', 'REJECTED'].includes(request.status)) {
      request = await this.api.application<BillingVoidRequest>(
        `/void-requests/${request.id}/submit`,
        apiKey,
        { method: 'POST' },
      );
      await this.apply(sale.id, request);
    }
  }

  async handleOutboxFailure(
    job: { id: string; ventaId: bigint; attempts: number; maxAttempts: number },
    error: unknown,
  ) {
    const retryable = error instanceof BillingApiError ? error.retryable : true;
    const dead = !retryable || job.attempts >= job.maxAttempts;
    const delay = Math.min(
      15 * 60_000,
      10_000 * 2 ** Math.min(job.attempts, 6),
    );
    await this.prisma.$transaction([
      this.prisma.billingOutbox.update({
        where: { id: job.id },
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
          sunatBajaEstado: dead ? 'error_definitivo' : 'error_transitorio',
          sunatBajaMensaje: safeMessage(error),
          billingVoidUpdatedAt: new Date(),
        },
      }),
    ]);
    if (dead) await this.restoreAccount(job.ventaId);
  }

  async apply(ventaId: bigint, request: BillingVoidRequest) {
    const updatedAt = request.updatedAt
      ? new Date(request.updatedAt)
      : new Date();
    const sale = await this.prisma.venta.findUnique({
      where: { id: ventaId },
      select: { billingVoidUpdatedAt: true },
    });
    if (sale?.billingVoidUpdatedAt && sale.billingVoidUpdatedAt > updatedAt)
      return;
    const state = voidState(request.status);
    await this.prisma.venta.update({
      where: { id: ventaId },
      data: {
        billingVoidRequestId: request.id,
        billingVoidUpdatedAt: updatedAt,
        sunatBajaEstado: state,
        sunatBajaTipo: request.procedure === 'VOIDED_DOCUMENTS' ? 'RA' : 'RC',
        sunatBajaCodigo: request.sunat?.code ?? null,
        sunatBajaMensaje: request.sunat?.message ?? null,
        sunatBajaTicket: request.ticket ?? null,
        sunatBajaRespondidaAt: dateOrNull(request.sunat?.respondedAt),
      },
    });
    if (request.status === 'ACCEPTED')
      await this.finalizeCommercialAnnul(ventaId);
    if (request.status === 'REJECTED' || request.status === 'FAILED') {
      await this.restoreAccount(ventaId);
    }
  }

  async publicStatus(empresaId: bigint, publicId: string) {
    const sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      include: { sunatBajaLote: true },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    return {
      publicId: sale.publicId,
      correlativo: sale.correlativo,
      estado: sale.estado,
      tipoAnulacion: sale.tipoAnulacion,
      razon: sale.anuladoRazon,
      anuladoAt: sale.anuladoAt?.toISOString() ?? null,
      sunatBaja: {
        estado: sale.sunatBajaEstado ?? 'no_aplica',
        codigo: sale.sunatBajaCodigo,
        mensaje: sale.sunatBajaMensaje,
        ticket: sale.sunatBajaTicket,
        tipo: sale.sunatBajaTipo,
        lote: null,
        xmlDisponible: Boolean(sale.billingVoidRequestId),
        cdrDisponible:
          Boolean(sale.billingVoidRequestId) &&
          ['aceptado', 'observado', 'rechazado'].includes(
            sale.sunatBajaEstado ?? '',
          ),
        solicitadaAt: sale.sunatBajaSolicitadaAt?.toISOString() ?? null,
        respondidaAt: sale.sunatBajaRespondidaAt?.toISOString() ?? null,
      },
      message: 'Estado de baja SUNAT actualizado.',
    };
  }

  async consult(empresaId: bigint, publicId: string) {
    const sale = await this.voidSale(empresaId, publicId);
    const apiKey = await this.integration.apiKey(
      empresaId,
      sale.billingEnvironment!,
    );
    const request = await this.api.application<BillingVoidRequest>(
      `/void-requests/${sale.billingVoidRequestId}`,
      apiKey,
    );
    await this.apply(sale.id, request);
    return this.publicStatus(empresaId, publicId);
  }

  async retry(empresaId: bigint, publicId: string) {
    const sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (!sale.billingEnvironment) {
      throw new BadRequestException('La venta no pertenece a Billing');
    }
    if (sale.sunatBajaEstado !== 'error_definitivo') {
      throw new BadRequestException('Solo una baja fallida puede reintentarse');
    }
    const sequence = sale.billingVoidRetrySequence + 1;
    if (!sale.billingVoidRequestId) {
      await this.prisma.$transaction([
        this.prisma.billingOutbox.update({
          where: {
            ventaId_environment_operation: {
              ventaId: sale.id,
              environment: sale.billingEnvironment,
              operation: 'VOID',
            },
          },
          data: {
            status: 'PENDING',
            attempts: 0,
            nextAttemptAt: new Date(),
            lockedAt: null,
            lastError: null,
            processedAt: null,
          },
        }),
        this.prisma.venta.update({
          where: { id: sale.id },
          data: {
            billingVoidRetrySequence: sequence,
            billingVoidUpdatedAt: new Date(),
            sunatBajaEstado: 'pendiente_envio',
            sunatBajaMensaje: 'Reintento de baja programado.',
          },
        }),
        this.prisma.cuentaPorCobrar.updateMany({
          where: { ventaId: sale.id },
          data: { estado: 'anulacion_pendiente' },
        }),
      ]);
      return this.publicStatus(empresaId, publicId);
    }
    const apiKey = await this.integration.apiKey(
      empresaId,
      sale.billingEnvironment,
    );
    const request = await this.api.application<BillingVoidRequest>(
      `/void-requests/${sale.billingVoidRequestId}/retry`,
      apiKey,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': `nuvex:${sale.billingEnvironment.toLowerCase()}:sale:${sale.publicId}:void-retry:${sequence}`,
        },
      },
    );
    await this.prisma.venta.update({
      where: { id: sale.id },
      data: { billingVoidRetrySequence: sequence },
    });
    await this.apply(sale.id, request);
    return this.publicStatus(empresaId, publicId);
  }

  async artifact(empresaId: bigint, publicId: string, kind: 'xml' | 'cdr') {
    const sale = await this.voidSale(empresaId, publicId);
    const apiKey = await this.integration.apiKey(
      empresaId,
      sale.billingEnvironment!,
    );
    let artifact: BillingVoidArtifact;
    if (kind === 'xml') {
      const response = await this.api.application<{
        artifacts: { xml: BillingVoidArtifact };
      }>(`/void-requests/${sale.billingVoidRequestId}/artifacts`, apiKey, {
        method: 'POST',
      });
      artifact = response.artifacts.xml;
    } else {
      artifact = await this.api.application<BillingVoidArtifact>(
        `/void-requests/${sale.billingVoidRequestId}/cdr`,
        apiKey,
      );
    }
    const downloaded = await this.api.download(artifact.url);
    return {
      buffer: downloaded.bytes,
      filename: artifact.fileName,
      contentType:
        artifact.contentType ??
        (kind === 'xml' ? 'application/xml' : 'application/zip'),
    };
  }

  private async voidSale(empresaId: bigint, publicId: string) {
    const sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (!sale.billingVoidRequestId || !sale.billingEnvironment) {
      throw new BadRequestException('La venta no tiene baja Billing asociada');
    }
    return sale;
  }

  private async finalizeCommercialAnnul(ventaId: bigint) {
    await this.prisma.$transaction(async (tx) => {
      const sale = await tx.venta.findUnique({
        where: { id: ventaId },
        include: {
          pagos: {
            include: { cajaMovimientos: { include: { cajaSesion: true } } },
          },
          detalles: true,
          cuentaPorCobrar: true,
        },
      });
      if (!sale || sale.estado === VentaEstado.anulada) return;
      const movements = sale.pagos
        .filter((payment) => payment.estado === 'activo')
        .flatMap((payment) =>
          payment.cajaMovimientos.filter(
            (movement) =>
              (movement.tipo === CajaMovimientoTipo.venta ||
                movement.tipo === CajaMovimientoTipo.cobranza) &&
              movement.cajaSesion.estado === CajaSesionEstado.abierta,
          ),
        );
      if (movements.length) {
        await tx.cajaMovimiento.createMany({
          data: movements.map((movement) => ({
            empresaId: sale.empresaId,
            cajaSesionId: movement.cajaSesionId,
            ventaId: sale.id,
            ventaPagoId: movement.ventaPagoId,
            metodoPagoId: movement.metodoPagoId,
            tipo: CajaMovimientoTipo.anulacion_venta,
            monto: movement.monto.mul(-1),
            motivo: sale.anuladoRazon ?? 'Baja SUNAT aceptada',
            referencia: movement.referencia,
          })),
        });
      }
      if (sale.sucursalId) {
        for (const detail of sale.detalles) {
          await this.stock.changeStock(tx, {
            empresaId: sale.empresaId,
            sucursalId: sale.sucursalId,
            productoVarianteId: detail.productoVarianteId,
            delta: detail.cantidad,
            tipo: StockMovimientoTipo.anulacion_venta,
            motivo: sale.anuladoRazon ?? 'Baja SUNAT aceptada',
            creadoPorId: sale.creadoPorId,
            referenciaTipo: 'venta',
            referenciaId: sale.id,
          });
        }
      }
      await tx.ventaPago.updateMany({
        where: { ventaId: sale.id },
        data: { estado: 'anulado' },
      });
      if (sale.cuentaPorCobrar) {
        await tx.cuentaPorCobrar.update({
          where: { id: sale.cuentaPorCobrar.id },
          data: { estado: 'anulada', saldoPendiente: new Prisma.Decimal(0) },
        });
        await tx.cuentaPorCobrarCuota.updateMany({
          where: { cuentaPorCobrarId: sale.cuentaPorCobrar.id },
          data: { estado: 'anulada', saldo: new Prisma.Decimal(0) },
        });
      }
      await tx.venta.update({
        where: { id: sale.id },
        data: { estado: 'anulada', anuladoAt: new Date() },
      });
    });
  }

  private async restoreAccount(ventaId: bigint) {
    const account = await this.prisma.cuentaPorCobrar.findUnique({
      where: { ventaId },
    });
    if (account?.estado !== CuentaPorCobrarEstado.anulacion_pendiente) return;
    await this.prisma.cuentaPorCobrar.update({
      where: { id: account.id },
      data: {
        estado: account.saldoPendiente.equals(0)
          ? CuentaPorCobrarEstado.pagada
          : account.adelanto.gt(0)
            ? CuentaPorCobrarEstado.parcial
            : CuentaPorCobrarEstado.pendiente,
      },
    });
  }
}

function voidState(status: BillingVoidRequest['status']): SunatBajaEstado {
  const states: Record<BillingVoidRequest['status'], SunatBajaEstado> = {
    PENDING: SunatBajaEstado.pendiente_envio,
    SUBMITTED: SunatBajaEstado.pendiente_cdr,
    PROCESSING: SunatBajaEstado.pendiente_cdr,
    ACCEPTED: SunatBajaEstado.aceptado,
    REJECTED: SunatBajaEstado.rechazado,
    FAILED: SunatBajaEstado.error_definitivo,
  };
  return states[status];
}

function dateOrNull(value?: string | null) {
  return value ? new Date(value) : null;
}

function safeMessage(error: unknown) {
  return (
    error instanceof Error ? error.message : 'Error de baja Billing'
  ).slice(0, 1000);
}
