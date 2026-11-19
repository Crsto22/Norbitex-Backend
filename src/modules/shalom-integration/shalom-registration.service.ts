import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VentaEnvioEstadoLogistico } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { resolveShalomAgencyName } from './shalom-agency';
import { ShalomApiClientService } from './shalom-api-client.service';
import { ShalomIntegrationService } from './shalom-integration.service';
import { toEstadoLogistico, type ShalomRemoteStatus } from './shalom-status';
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

type TrackingResponse = {
  status: ShalomRemoteStatus;
  label?: string | null;
  estado?: string | null;
  progreso?: number;
  pasos?: Array<{ nombre: string; activo: boolean }>;
};

/** Evita scrapear Shalom en cada clic del boton de actualizar. */
const TRACKING_COOLDOWN_MS = 60_000;

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
  async register(
    empresaId: bigint,
    publicId: string,
    dto: RegisterShalomDto,
    usuarioId?: bigint | null,
  ) {
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
    if (!envio.dni && !dto.recipientDocument) {
      throw new BadRequestException(
        'El envio no tiene documento del destinatario',
      );
    }
    const recipientDocument = normalizeDocument(
      dto.recipientDocument ?? envio.dni,
    );
    if (!recipientDocument) {
      throw new BadRequestException(
        'El documento del destinatario no es valido',
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
      recipientDocument,
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

      await this.updateRecipientData(
        envio,
        {
          documento: recipientDocument,
          tipoDocumento: documentType,
          nombre: composeFullName(dto),
          celular: recipientPhone ?? null,
        },
        usuarioId ?? null,
      );

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
      estadoLabel: envio.shalomEstadoLabel,
      progreso: envio.shalomProgreso,
      timeline: envio.shalomTimeline,
      error: envio.shalomError,
      registradoAt: envio.shalomRegistradoAt,
      syncAt: envio.shalomSyncAt,
      estadoLogistico: envio.estadoLogistico,
    };
  }

  /**
   * Consulta el estado en vivo en Shalom (rastreo) y lo aplica al envio.
   * Tiene un cooldown para no scrapear la pagina en cada clic.
   */
  async track(empresaId: bigint, publicId: string) {
    const venta = await this.integration.requireEnvio(empresaId, publicId);
    const envio = venta.envio!;

    if (!envio.shalomOrden) {
      throw new BadRequestException('El envio aun no tiene orden de Shalom');
    }

    const lastSync = envio.shalomSyncAt?.getTime() ?? 0;
    if (Date.now() - lastSync < TRACKING_COOLDOWN_MS) {
      return this.status(empresaId, publicId);
    }

    const credentials = await this.integration.requireCredentials(empresaId);
    const tracking = await this.client.track<TrackingResponse>(
      envio.shalomOrden,
      envio.shalomCodigo ?? undefined,
      credentials.apiKey,
    );

    if (!tracking?.status) {
      throw new BadRequestException(
        'Shalom no devolvio un estado para esta guia',
      );
    }

    await this.applyTrackingStatus(
      envio.id,
      {
        status: tracking.status,
        label: tracking.label ?? tracking.estado ?? tracking.status,
        progress: tracking.progreso ?? 0,
      },
      toEstadoLogistico(tracking.status),
      tracking.pasos,
    );

    await this.integration.markSynced(empresaId);

    return this.status(empresaId, publicId);
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
    timeline?: Array<{ nombre: string; activo: boolean }> | null,
  ) {
    const envio = await this.prisma.ventaEnvio.findUnique({
      where: { id: ventaEnvioId },
    });
    if (!envio) throw new NotFoundException('Envio no encontrado');

    const data: Record<string, unknown> = {
      shalomEstado: remote.status,
      shalomEstadoLabel: remote.label?.slice(0, 80) ?? null,
      shalomProgreso: remote.progress ?? null,
      shalomSyncAt: new Date(),
    };

    if (timeline && timeline.length > 0) {
      data.shalomTimeline = timeline;
    }

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
   * Guarda en el envio los datos corregidos en el modal de Shalom.
   * Solo destinatario (documento, tipo, nombres, celular) y deja historial.
   */
  private async updateRecipientData(
    envio: {
      id: bigint;
      codigoPublico: string;
      dni: string | null;
      tipoDocumento: string;
      nombreCompleto: string | null;
      celular: string | null;
      estadoLogistico: VentaEnvioEstadoLogistico;
    },
    data: {
      documento: string;
      tipoDocumento: string;
      nombre: string | null;
      celular: string | null;
    },
    usuarioId: bigint | null,
  ) {
    const updates: Prisma.VentaEnvioUpdateInput = {};
    const changed: string[] = [];

    if (data.documento && data.documento !== envio.dni) {
      updates.dni = data.documento;
      changed.push('documento');
    }
    if (data.tipoDocumento && data.tipoDocumento !== envio.tipoDocumento) {
      updates.tipoDocumento = data.tipoDocumento;
      changed.push('tipo de documento');
    }
    if (data.nombre && data.nombre !== envio.nombreCompleto) {
      updates.nombreCompleto = data.nombre.slice(0, 150);
      changed.push('nombres');
    }
    if (data.celular && data.celular !== envio.celular) {
      updates.celular = data.celular;
      changed.push('celular');
    }

    if (changed.length === 0) return;

    try {
      await this.prisma.ventaEnvio.update({
        where: { id: envio.id },
        data: updates,
      });

      await this.prisma.ventaEnvioHistorial.create({
        data: {
          ventaEnvioId: envio.id,
          estadoAnterior: envio.estadoLogistico,
          estadoNuevo: envio.estadoLogistico,
          detalle:
            `Datos del destinatario corregidos desde el registro Shalom: ${changed.join(', ')}`.slice(
              0,
              500,
            ),
          usuarioId,
        },
      });

      this.logger.log(
        `Datos del envio ${envio.codigoPublico} actualizados desde el registro Shalom (${changed.join(', ')})`,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudieron actualizar los datos del envio ${envio.codigoPublico}: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  /**
   * Agencia de origen: la elegida para este envio o, si no se envia,
   * la configurada en Configuracion -> Shalom PRO (no se sobrescribe).
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

    return origin;
  }
}

function digits(value?: string | null) {
  return (value ?? '').replace(/\D/g, '');
}

/** Une nombres y apellidos del modal en el nombre completo del envio. */
function composeFullName(dto: RegisterShalomDto) {
  const value = [
    dto.recipientName,
    dto.recipientPaternalLastName,
    dto.recipientMaternalLastName,
  ]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return value || null;
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

function normalizeDocument(value?: string | null) {
  const digitsValue = digits(value);
  return /^\d{6,12}$/.test(digitsValue) ? digitsValue : null;
}
