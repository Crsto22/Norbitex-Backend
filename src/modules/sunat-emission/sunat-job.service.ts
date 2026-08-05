import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SunatJobEstado, SunatJobTipoDocumento } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SunatJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  enqueueVenta(empresaId: bigint, ventaId: bigint) {
    return this.enqueue(empresaId, SunatJobTipoDocumento.venta, ventaId);
  }

  enqueueBajaLote(empresaId: bigint, loteId: bigint) {
    return this.enqueue(empresaId, SunatJobTipoDocumento.baja_lote, loteId);
  }

  enqueueGuiaRemision(empresaId: bigint, guiaId: bigint) {
    return this.enqueue(empresaId, SunatJobTipoDocumento.guia_remision, guiaId);
  }

  enqueueNotaCredito(empresaId: bigint, notaCreditoId: bigint) {
    return this.enqueue(
      empresaId,
      SunatJobTipoDocumento.nota_credito,
      notaCreditoId,
    );
  }

  private enqueue(
    empresaId: bigint,
    tipoDocumento: SunatJobTipoDocumento,
    documentoId: bigint,
  ) {
    const configuredRetries = Number(
      this.configService.get<string>('SUNAT_JOB_MAX_RETRIES'),
    );
    const maxIntentos =
      Number.isFinite(configuredRetries) && configuredRetries > 0
        ? configuredRetries
        : 10;

    return this.prisma.sunatJob.upsert({
      where: {
        tipoDocumento_documentoId: {
          tipoDocumento,
          documentoId,
        },
      },
      create: {
        empresaId,
        tipoDocumento,
        documentoId,
        estado: SunatJobEstado.pendiente_envio,
        maxIntentos,
        nextRetryAt: new Date(),
      },
      update: {
        empresaId,
        estado: SunatJobEstado.pendiente_envio,
        intentos: 0,
        maxIntentos,
        ultimoCodigo: null,
        ultimoError: null,
        nextRetryAt: new Date(),
        lockedAt: null,
        lastAttemptAt: null,
        processedAt: null,
      },
    });
  }
}
