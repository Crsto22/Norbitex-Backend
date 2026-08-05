import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import {
  SunatEstado,
  SunatBajaEstado,
  SunatJobEstado,
  SunatJobTipoDocumento,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SunatBajaService } from './sunat-baja.service';
import { SunatCreditNoteEmissionService } from './sunat-credit-note-emission.service';
import { SunatEmissionService } from './sunat-emission.service';
import { SunatGuiaRemisionService } from './sunat-guia-remision.service';

@Injectable()
export class SunatJobRunnerService {
  private readonly logger = new Logger(SunatJobRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly sunatEmissionService: SunatEmissionService,
    private readonly sunatBajaService: SunatBajaService,
    private readonly sunatGuiaRemisionService: SunatGuiaRemisionService,
    private readonly sunatCreditNoteEmissionService: SunatCreditNoteEmissionService,
  ) {}

  @Cron('*/15 * * * * *')
  async processQueue() {
    const batchSize = this.numberEnv('SUNAT_JOB_BATCH_SIZE', 10);
    const lockMinutes = this.numberEnv('SUNAT_JOB_LOCK_MINUTES', 10);
    const now = new Date();
    const lockExpiredAt = new Date(now.getTime() - lockMinutes * 60_000);
    const jobs = await this.prisma.sunatJob.findMany({
      where: {
        estado: SunatJobEstado.pendiente_envio,
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        AND: [
          {
            OR: [{ lockedAt: null }, { lockedAt: { lt: lockExpiredAt } }],
          },
        ],
      },
      orderBy: [{ nextRetryAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });

    for (const job of jobs) {
      try {
        await this.processJob(job.id);
      } catch (error) {
        this.logger.error(
          `Error procesando job SUNAT ${job.id.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async processJob(jobId: bigint) {
    const claimed = await this.prisma.sunatJob.updateMany({
      where: {
        id: jobId,
        estado: SunatJobEstado.pendiente_envio,
      },
      data: {
        estado: SunatJobEstado.procesando,
        lockedAt: new Date(),
        lastAttemptAt: new Date(),
        intentos: { increment: 1 },
      },
    });

    if (claimed.count === 0) {
      return;
    }

    const job = await this.prisma.sunatJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return;
    }

    if (job.tipoDocumento === SunatJobTipoDocumento.venta) {
      await this.processVentaJob(jobId, job.documentoId);
      return;
    }

    if (job.tipoDocumento === SunatJobTipoDocumento.baja_lote) {
      await this.processBajaJob(jobId, job.documentoId);
      return;
    }

    if (job.tipoDocumento === SunatJobTipoDocumento.guia_remision) {
      await this.processGuiaRemisionJob(jobId, job.documentoId);
      return;
    }

    if (job.tipoDocumento === SunatJobTipoDocumento.nota_credito) {
      await this.processNotaCreditoJob(jobId, job.documentoId);
      return;
    }

    await this.finalize(jobId, 'TIPO', 'Tipo de job SUNAT no soportado');
  }

  private async processVentaJob(jobId: bigint, ventaId: bigint) {
    await this.sunatEmissionService.processVenta(ventaId);
    const sale = await this.prisma.venta.findUnique({
      where: { id: ventaId },
      select: {
        sunatEstado: true,
        sunatCodigo: true,
        sunatMensaje: true,
      },
    });

    if (!sale) {
      await this.finalize(jobId, 'NOT_FOUND', 'La venta asociada ya no existe');
      return;
    }

    await this.syncJobWithSaleState(jobId, sale);
  }

  private async processBajaJob(jobId: bigint, loteId: bigint) {
    await this.sunatBajaService.processLote(loteId);
    const lote = await this.prisma.sunatBajaLote.findUnique({
      where: { id: loteId },
      select: {
        estado: true,
        codigo: true,
        mensaje: true,
      },
    });

    if (!lote) {
      await this.finalize(
        jobId,
        'NOT_FOUND',
        'El lote de baja asociado ya no existe',
      );
      return;
    }

    await this.syncJobWithBajaState(jobId, lote, loteId);
  }

  private async processGuiaRemisionJob(jobId: bigint, guiaId: bigint) {
    await this.sunatGuiaRemisionService.processGuia(guiaId);
    const guia = await this.prisma.guiaRemision.findUnique({
      where: { id: guiaId },
      select: {
        sunatEstado: true,
        sunatCodigo: true,
        sunatMensaje: true,
      },
    });

    if (!guia) {
      await this.finalize(jobId, 'NOT_FOUND', 'La guia asociada ya no existe');
      return;
    }

    await this.syncJobWithGuiaState(jobId, guia);
  }

  private async processNotaCreditoJob(jobId: bigint, notaCreditoId: bigint) {
    await this.sunatCreditNoteEmissionService.process(notaCreditoId);
    const note = await this.prisma.notaCredito.findUnique({
      where: { id: notaCreditoId },
      select: {
        sunatEstado: true,
        sunatCodigo: true,
        sunatMensaje: true,
      },
    });

    if (!note) {
      await this.finalize(
        jobId,
        'NOT_FOUND',
        'La nota de credito asociada ya no existe',
      );
      return;
    }

    await this.syncJobWithCreditNoteState(jobId, note);
  }

  private async syncJobWithSaleState(
    jobId: bigint,
    sale: {
      sunatEstado: SunatEstado;
      sunatCodigo: string | null;
      sunatMensaje: string | null;
    },
  ) {
    const job = await this.prisma.sunatJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return;
    }

    const finalSaleStates: SunatEstado[] = [
      SunatEstado.no_aplica,
      SunatEstado.aceptado,
      SunatEstado.observado,
      SunatEstado.rechazado,
      SunatEstado.error_definitivo,
    ];

    if (finalSaleStates.includes(sale.sunatEstado)) {
      await this.prisma.sunatJob.update({
        where: { id: jobId },
        data: {
          estado:
            sale.sunatEstado === SunatEstado.error_definitivo
              ? SunatJobEstado.error_definitivo
              : SunatJobEstado.finalizado,
          ultimoCodigo: sale.sunatCodigo,
          ultimoError: sale.sunatMensaje,
          lockedAt: null,
          nextRetryAt: null,
          processedAt: new Date(),
        },
      });
      return;
    }

    if (job.intentos >= job.maxIntentos) {
      await this.prisma.$transaction([
        this.prisma.venta.update({
          where: { id: job.documentoId },
          data: {
            sunatEstado: SunatEstado.error_definitivo,
            sunatCodigo: sale.sunatCodigo ?? 'RETRY',
            sunatMensaje:
              sale.sunatMensaje ?? 'Se agotaron los reintentos SUNAT',
          },
        }),
        this.prisma.sunatJob.update({
          where: { id: jobId },
          data: {
            estado: SunatJobEstado.error_definitivo,
            ultimoCodigo: sale.sunatCodigo,
            ultimoError: sale.sunatMensaje,
            lockedAt: null,
            nextRetryAt: null,
            processedAt: new Date(),
          },
        }),
      ]);
      return;
    }

    await this.prisma.sunatJob.update({
      where: { id: jobId },
      data: {
        estado: SunatJobEstado.pendiente_envio,
        ultimoCodigo: sale.sunatCodigo,
        ultimoError: sale.sunatMensaje,
        lockedAt: null,
        nextRetryAt: this.nextRetryAt(job.intentos),
      },
    });
  }

  private async finalize(jobId: bigint, code: string, message: string) {
    await this.prisma.sunatJob.update({
      where: { id: jobId },
      data: {
        estado: SunatJobEstado.error_definitivo,
        ultimoCodigo: code,
        ultimoError: message,
        lockedAt: null,
        processedAt: new Date(),
      },
    });
  }

  private async syncJobWithCreditNoteState(
    jobId: bigint,
    note: {
      sunatEstado: SunatEstado;
      sunatCodigo: string | null;
      sunatMensaje: string | null;
    },
  ) {
    const job = await this.prisma.sunatJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    const finalStates: SunatEstado[] = [
      SunatEstado.no_aplica,
      SunatEstado.aceptado,
      SunatEstado.observado,
      SunatEstado.rechazado,
      SunatEstado.error_definitivo,
    ];

    if (finalStates.includes(note.sunatEstado)) {
      await this.prisma.sunatJob.update({
        where: { id: jobId },
        data: {
          estado:
            note.sunatEstado === SunatEstado.error_definitivo
              ? SunatJobEstado.error_definitivo
              : SunatJobEstado.finalizado,
          ultimoCodigo: note.sunatCodigo,
          ultimoError: note.sunatMensaje,
          lockedAt: null,
          nextRetryAt: null,
          processedAt: new Date(),
        },
      });
      return;
    }

    if (job.intentos >= job.maxIntentos) {
      await this.prisma.$transaction([
        this.prisma.notaCredito.update({
          where: { id: job.documentoId },
          data: {
            sunatEstado: SunatEstado.error_definitivo,
            sunatCodigo: note.sunatCodigo ?? 'RETRY',
            sunatMensaje:
              note.sunatMensaje ?? 'Se agotaron los reintentos SUNAT',
          },
        }),
        this.prisma.sunatJob.update({
          where: { id: jobId },
          data: {
            estado: SunatJobEstado.error_definitivo,
            ultimoCodigo: note.sunatCodigo,
            ultimoError: note.sunatMensaje,
            lockedAt: null,
            nextRetryAt: null,
            processedAt: new Date(),
          },
        }),
      ]);
      return;
    }

    await this.prisma.sunatJob.update({
      where: { id: jobId },
      data: {
        estado: SunatJobEstado.pendiente_envio,
        ultimoCodigo: note.sunatCodigo,
        ultimoError: note.sunatMensaje,
        lockedAt: null,
        nextRetryAt: this.nextRetryAt(job.intentos),
      },
    });
  }

  private async syncJobWithGuiaState(
    jobId: bigint,
    guia: {
      sunatEstado: SunatEstado;
      sunatCodigo: string | null;
      sunatMensaje: string | null;
    },
  ) {
    const job = await this.prisma.sunatJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return;
    }

    const finalStates: SunatEstado[] = [
      SunatEstado.no_aplica,
      SunatEstado.aceptado,
      SunatEstado.observado,
      SunatEstado.rechazado,
      SunatEstado.error_definitivo,
    ];

    if (finalStates.includes(guia.sunatEstado)) {
      await this.prisma.sunatJob.update({
        where: { id: jobId },
        data: {
          estado:
            guia.sunatEstado === SunatEstado.error_definitivo
              ? SunatJobEstado.error_definitivo
              : SunatJobEstado.finalizado,
          ultimoCodigo: guia.sunatCodigo,
          ultimoError: guia.sunatMensaje,
          lockedAt: null,
          nextRetryAt: null,
          processedAt: new Date(),
        },
      });
      return;
    }

    if (job.intentos >= job.maxIntentos) {
      await this.prisma.$transaction([
        this.prisma.guiaRemision.update({
          where: { id: job.documentoId },
          data: {
            sunatEstado: SunatEstado.error_definitivo,
            sunatCodigo: guia.sunatCodigo ?? 'RETRY',
            sunatMensaje:
              guia.sunatMensaje ?? 'Se agotaron los reintentos SUNAT GRE',
          },
        }),
        this.prisma.sunatJob.update({
          where: { id: jobId },
          data: {
            estado: SunatJobEstado.error_definitivo,
            ultimoCodigo: guia.sunatCodigo,
            ultimoError: guia.sunatMensaje,
            lockedAt: null,
            nextRetryAt: null,
            processedAt: new Date(),
          },
        }),
      ]);
      return;
    }

    await this.prisma.sunatJob.update({
      where: { id: jobId },
      data: {
        estado: SunatJobEstado.pendiente_envio,
        ultimoCodigo: guia.sunatCodigo,
        ultimoError: guia.sunatMensaje,
        lockedAt: null,
        nextRetryAt: this.nextRetryAt(job.intentos),
      },
    });
  }

  private async syncJobWithBajaState(
    jobId: bigint,
    lote: {
      estado: SunatBajaEstado;
      codigo: string | null;
      mensaje: string | null;
    },
    loteId: bigint,
  ) {
    const job = await this.prisma.sunatJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return;
    }

    const finalStates: SunatBajaEstado[] = [
      SunatBajaEstado.no_aplica,
      SunatBajaEstado.aceptado,
      SunatBajaEstado.observado,
      SunatBajaEstado.rechazado,
      SunatBajaEstado.error_definitivo,
    ];

    if (finalStates.includes(lote.estado)) {
      await this.prisma.sunatJob.update({
        where: { id: jobId },
        data: {
          estado:
            lote.estado === SunatBajaEstado.error_definitivo
              ? SunatJobEstado.error_definitivo
              : SunatJobEstado.finalizado,
          ultimoCodigo: lote.codigo,
          ultimoError: lote.mensaje,
          lockedAt: null,
          nextRetryAt: null,
          processedAt: new Date(),
        },
      });
      return;
    }

    if (job.intentos >= job.maxIntentos) {
      await this.sunatBajaService.marcarErrorDefinitivo(
        loteId,
        lote.codigo ?? 'RETRY',
        lote.mensaje ?? 'Se agotaron los reintentos de baja SUNAT',
      );
      await this.prisma.sunatJob.update({
        where: { id: jobId },
        data: {
          estado: SunatJobEstado.error_definitivo,
          ultimoCodigo: lote.codigo,
          ultimoError: lote.mensaje,
          lockedAt: null,
          nextRetryAt: null,
          processedAt: new Date(),
        },
      });
      return;
    }

    await this.prisma.sunatJob.update({
      where: { id: jobId },
      data: {
        estado: SunatJobEstado.pendiente_envio,
        ultimoCodigo: lote.codigo,
        ultimoError: lote.mensaje,
        lockedAt: null,
        nextRetryAt: this.nextRetryAt(job.intentos),
      },
    });
  }

  private nextRetryAt(intentos: number) {
    const seconds = Math.min(300, Math.max(15, intentos * 30));
    return new Date(Date.now() + seconds * 1000);
  }

  private numberEnv(name: string, fallback: number) {
    const value = Number(this.configService.get<string>(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }
}
