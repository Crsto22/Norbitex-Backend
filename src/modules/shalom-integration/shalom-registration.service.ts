import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { VentaEnvioEstadoLogistico } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { resolveShalomAgencyName } from './shalom-agency';
import { ShalomApiClientService } from './shalom-api-client.service';
import { ShalomIntegrationService } from './shalom-integration.service';
import type { RegisterShalomDto } from './dto/shalom-config.dto';

type JobResponse = {
  id: string;
  status: string;
  errorMessage: string | null;
  result: {
    orderId?: string;
    orden?: string;
    codigo?: string | null;
    monto?: number | null;
  } | null;
};

/** Estados terminales de un job; cualquier otro significa "en proceso". */
const TERMINAL_JOB_STATES = new Set([
  'COMPLETED',
  'DEAD',
  'FAILED',
  'REGISTRADO',
  'ERROR',
]);

@Injectable()
export class ShalomRegistrationService {
  private readonly logger = new Logger(ShalomRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integration: ShalomIntegrationService,
    private readonly client: ShalomApiClientService,
    private readonly sales: SalesService,
  ) {}

  /** Encola el registro de la guia en shalom-service. */
  async register(empresaId: bigint, publicId: string, dto: RegisterShalomDto) {
    const venta = await this.integration.requireEnvio(empresaId, publicId);
    const envio = venta.envio!;

    if (envio.shalomOrden) {
      return {
        alreadyRegistered: true,
        orden: envio.shalomOrden,
        codigo: envio.shalomCodigo,
        jobId: envio.shalomJobId,
      };
    }

    if (envio.estado !== 'recibido') {
      throw new BadRequestException(
        'El cliente debe completar los datos de envio antes de registrar en Shalom',
      );
    }
    if (!envio.dni) {
      throw new BadRequestException(
        'El envio no tiene documento del destinatario',
      );
    }
    if (envio.estadoLogistico === VentaEnvioEstadoLogistico.ENTREGADO) {
      throw new BadRequestException('El envio ya fue entregado');
    }

    const credentials = await this.integration.requireCredentials(empresaId);

    // Un job en curso se reutiliza: la UI sigue consultando el mismo registro.
    if (
      envio.shalomJobId &&
      !TERMINAL_JOB_STATES.has(envio.shalomEstado ?? '')
    ) {
      return {
        alreadyRegistered: false,
        jobId: envio.shalomJobId,
        status: envio.shalomEstado,
      };
    }

    // El job termino pero la orden no se guardo (webhook perdido): evitar duplicar.
    if (
      envio.shalomJobId &&
      (envio.shalomEstado === 'COMPLETED' ||
        envio.shalomEstado === 'REGISTRADO')
    ) {
      throw new BadRequestException(
        'El registro ya se completo en Shalom. Actualiza la lista para ver la orden.',
      );
    }

    const destinationAgency = resolveShalomAgencyName(
      envio.agenciaExternalId,
      envio.agenciaNombre,
    );
    if (!destinationAgency) {
      throw new BadRequestException(
        'El envio no tiene una agencia de destino de Shalom valida',
      );
    }

    const originAgency = await this.resolveOriginAgency(
      empresaId,
      dto.originAgency,
    );
    const documentType = dto.documentType ?? envio.tipoDocumento ?? 'DNI';
    const recipientPhone = normalizePhone(dto.recipientPhone ?? envio.celular);

    const payload = {
      externalRef: envio.codigoPublico,
      recipientDocument: envio.dni,
      documentType,
      recipientName:
        dto.recipientName?.trim() || envio.nombreCompleto?.trim() || undefined,
      recipientPaternalLastName:
        dto.recipientPaternalLastName?.trim() || undefined,
      recipientMaternalLastName:
        dto.recipientMaternalLastName?.trim() || undefined,
      recipientPhone,
      originAgency,
      destinationAgency,
      packageType: dto.packageType ?? credentials.defaultPackageType,
      securityKey: dto.securityKey,
      extraSecurity: dto.extraSecurity ?? false,
      cashOnDelivery: dto.cashOnDelivery ?? false,
    };

    // El primer intento usa una clave estable (evita duplicados por doble clic);
    // los reintentos tras un job fallido usan una clave nueva.
    const attempt = envio.shalomJobId ? `retry-${Date.now()}` : 'v1';
    const idempotencyKey = `envio:${envio.codigoPublico}:${attempt}`;

    try {
      const job = await this.client.registerOrder<{
        jobId: string;
        status: string;
      }>(credentials.tenantId, credentials.apiKey, payload, idempotencyKey);

      await this.prisma.ventaEnvio.update({
        where: { id: envio.id },
        data: {
          shalomJobId: job.jobId,
          shalomEstado: job.status,
          shalomError: null,
          shalomSyncAt: new Date(),
        },
      });

      return { alreadyRegistered: false, jobId: job.jobId, status: job.status };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error desconocido';
      await this.prisma.ventaEnvio.update({
        where: { id: envio.id },
        data: { shalomError: message.slice(0, 500), shalomEstado: 'ERROR' },
      });
      await this.integration.markError(empresaId, message);
      throw new BadRequestException(`Shalom: ${message}`);
    }
  }

  async status(empresaId: bigint, publicId: string) {
    const venta = await this.integration.requireEnvio(empresaId, publicId);
    const envio = venta.envio!;

    return {
      jobId: envio.shalomJobId,
      orden: envio.shalomOrden,
      codigo: envio.shalomCodigo,
      monto: envio.shalomMonto,
      estado: envio.shalomEstado,
      error: envio.shalomError,
      registradoAt: envio.shalomRegistradoAt,
      syncAt: envio.shalomSyncAt,
      estadoLogistico: envio.estadoLogistico,
    };
  }

  /** Sincroniza el resultado del job cuando el webhook no llego. */
  async sync(empresaId: bigint, publicId: string, actorId?: bigint | null) {
    const venta = await this.integration.requireEnvio(empresaId, publicId);
    const envio = venta.envio!;

    if (!envio.shalomJobId) {
      throw new BadRequestException('El envio no tiene un job de Shalom');
    }

    const credentials = await this.integration.requireCredentials(empresaId);
    const job = await this.client.getJob<JobResponse>(
      envio.shalomJobId,
      credentials.apiKey,
    );

    if (job.status === 'COMPLETED' && job.result?.orden) {
      await this.applyRegistration(
        envio.id,
        {
          orden: job.result.orden,
          codigo: job.result.codigo ?? null,
          monto: job.result.monto ?? null,
          estado: 'REGISTRADO',
        },
        { actorId },
      );
      return this.status(empresaId, publicId);
    }

    if (job.status === 'DEAD' || job.status === 'FAILED') {
      await this.prisma.ventaEnvio.update({
        where: { id: envio.id },
        data: {
          shalomEstado: job.status,
          shalomError: job.errorMessage?.slice(0, 500) ?? 'Job fallido',
        },
      });
    } else {
      await this.prisma.ventaEnvio.update({
        where: { id: envio.id },
        data: { shalomEstado: job.status, shalomSyncAt: new Date() },
      });
    }

    return this.status(empresaId, publicId);
  }

  /**
   * Aplica el resultado del registro (usado por sync y por webhook).
   * Despues del registro se marca el envio como despachado (automatico).
   */
  async applyRegistration(
    ventaEnvioId: bigint,
    data: {
      orden: string;
      codigo: string | null;
      monto: number | null;
      estado: string;
    },
    options: { actorId?: bigint | null } = {},
  ) {
    const updated = await this.prisma.ventaEnvio.update({
      where: { id: ventaEnvioId },
      data: {
        shalomOrden: data.orden,
        shalomCodigo: data.codigo,
        shalomMonto: data.monto,
        shalomEstado: data.estado,
        shalomError: null,
        shalomRegistradoAt: new Date(),
        shalomSyncAt: new Date(),
      },
    });

    await this.prisma.ventaEnvioHistorial.create({
      data: {
        ventaEnvioId,
        estadoAnterior: updated.estadoLogistico,
        estadoNuevo: updated.estadoLogistico,
        detalle: `Registrado en Shalom: ${data.orden}${data.codigo ? ` / ${data.codigo}` : ''}`,
      },
    });

    await this.autoDispatch(ventaEnvioId, data.orden, options.actorId ?? null);

    return updated;
  }

  /** Aplica un cambio de estado del rastreo. */
  async applyTrackingStatus(
    ventaEnvioId: bigint,
    remote: { status: string; label: string; progress: number },
    estadoLogistico: VentaEnvioEstadoLogistico | null,
  ) {
    const envio = await this.prisma.ventaEnvio.findUnique({
      where: { id: ventaEnvioId },
    });
    if (!envio) throw new NotFoundException('Envio no encontrado');

    const data: Record<string, unknown> = {
      shalomEstado: remote.status,
      shalomSyncAt: new Date(),
    };

    if (estadoLogistico && estadoLogistico !== envio.estadoLogistico) {
      data.estadoLogistico = estadoLogistico;
      if (estadoLogistico === VentaEnvioEstadoLogistico.ENTREGADO) {
        data.entregadoAt = new Date();
      }
    }

    const updated = await this.prisma.ventaEnvio.update({
      where: { id: ventaEnvioId },
      data,
    });

    if (estadoLogistico && estadoLogistico !== envio.estadoLogistico) {
      await this.prisma.ventaEnvioHistorial.create({
        data: {
          ventaEnvioId,
          estadoAnterior: envio.estadoLogistico,
          estadoNuevo: estadoLogistico,
          detalle: `Shalom: ${remote.label}`.slice(0, 500),
        },
      });
    }

    return updated;
  }

  /**
   * Marca el envio como despachado tras registrarlo en Shalom.
   * Es idempotente y no rompe el registro si el despacho falla.
   */
  private async autoDispatch(
    ventaEnvioId: bigint,
    orden: string,
    actorId: bigint | null,
  ) {
    const envio = await this.prisma.ventaEnvio.findUnique({
      where: { id: ventaEnvioId },
      select: {
        venta: { select: { empresaId: true, publicId: true } },
      },
    });

    if (!envio) return;

    try {
      const result = await this.sales.dispatchShalomEnvio(
        envio.venta.empresaId,
        envio.venta.publicId,
        { orden, actorId },
      );

      if (result) {
        this.logger.log(
          `Envio ${envio.venta.publicId} despachado automaticamente por Shalom (${orden})`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo despachar automaticamente el envio ${envio.venta.publicId}: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  /**
   * Agencia de origen: la elegida en el modal (se recuerda) o la guardada
   * previamente en los ajustes de exportacion.
   */
  private async resolveOriginAgency(empresaId: bigint, requested?: string) {
    const config = await this.prisma.empresaShalomExportConfig.findUnique({
      where: { empresaId },
    });

    const origin = requested?.trim() || config?.origen?.trim() || '';
    if (!origin) {
      throw new BadRequestException(
        'Configura la agencia de origen de Shalom antes de registrar',
      );
    }

    if (requested?.trim() && requested.trim() !== config?.origen?.trim()) {
      await this.prisma.empresaShalomExportConfig.upsert({
        where: { empresaId },
        create: { empresaId, origen: origin },
        update: { origen: origin },
      });
    }

    return origin;
  }
}

function digits(value?: string | null) {
  return (value ?? '').replace(/\D/g, '');
}

/** Shalom solo acepta celulares peruanos de 9 digitos (sin +51). */
function normalizePhone(value?: string | null) {
  const digitsValue = digits(value);
  const local =
    digitsValue.length > 9 && digitsValue.startsWith('51')
      ? digitsValue.slice(2)
      : digitsValue;
  return /^9\d{8}$/.test(local) ? local : undefined;
}
