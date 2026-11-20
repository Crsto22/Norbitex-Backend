import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AgenciaCourierProveedor,
  Prisma,
  VentaEnvioEstadoLogistico,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  composePersonFullName,
  resolvePersonNameParts,
} from '../../common/person-name';
import { SalesService } from '../sales/sales.service';
import { resolveShalomAgencyName, isPlaceholderAgency } from './shalom-agency';
import {
  ShalomApiClientService,
  ShalomApiError,
} from './shalom-api-client.service';
import { ShalomIntegrationService } from './shalom-integration.service';
import { toEstadoLogistico, type ShalomRemoteStatus } from './shalom-status';
import type {
  BulkRegisterShalomDto,
  RegisterShalomDto,
} from './dto/shalom-config.dto';
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

/** Limites del registro masivo (mismos que el formato de Shalom). */
const MAX_BULK_ORDERS = 50;
const MAX_BULK_PER_RECIPIENT = 10;

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

    // Solo se puede registrar hacia agencias que existen en el formulario de
    // Shalom: las "(POR DEFINIR)" o los puntos internos (aeropuertos,
    // almacenes, pruebas) nunca aparecen en el combo.
    const destinationRecord = envio.agenciaExternalId
      ? await this.prisma.agenciaCourier.findFirst({
          where: {
            courier: AgenciaCourierProveedor.SHALOM,
            externalId: envio.agenciaExternalId,
          },
          select: { registrableDestino: true },
        })
      : null;

    if (
      isPlaceholderAgency(envio.agenciaNombre) ||
      destinationRecord?.registrableDestino === false
    ) {
      throw new BadRequestException(
        `La agencia "${destinationAgency}" no esta habilitada para registrar guias en Shalom. Elige otra agencia de destino.`,
      );
    }

    const originAgency = await this.resolveOriginAgency(
      empresaId,
      dto.originAgency,
    );
    const documentType = dto.documentType ?? envio.tipoDocumento ?? 'DNI';
    const recipientPhone = normalizePhone(dto.recipientPhone ?? envio.celular);

    // Shalom pide nombres y apellidos por separado. Se prioriza lo que venga
    // del modal y, si falta, se usan las columnas del envio o se dividen del
    // nombre completo guardado por el enlace publico.
    const recipientNameParts = resolvePersonNameParts(envio, {
      nombres: dto.recipientName,
      apellidoPaterno: dto.recipientPaternalLastName,
      apellidoMaterno: dto.recipientMaternalLastName,
    });

    const payload = {
      externalRef: envio.codigoPublico,
      recipientDocument,
      documentType,
      recipientName: recipientNameParts.nombres ?? undefined,
      recipientPaternalLastName:
        recipientNameParts.apellidoPaterno ?? undefined,
      recipientMaternalLastName:
        recipientNameParts.apellidoMaterno ?? undefined,
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
          shalomOrigen: originAgency,
          shalomError: null,
          shalomSyncAt: new Date(),
        },
      });

      await this.updateRecipientData(
        envio,
        {
          documento: recipientDocument,
          tipoDocumento: documentType,
          nombre: composePersonFullName(recipientNameParts),
          nombres: recipientNameParts.nombres,
          apellidoPaterno: recipientNameParts.apellidoPaterno,
          apellidoMaterno: recipientNameParts.apellidoMaterno,
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

  /**
   * Registro masivo (max. 50) con una clave global para todo el lote.
   * Valida 10 envios por destinatario y devuelve el resultado por envio.
   */
  async registerBulk(
    empresaId: bigint,
    dto: BulkRegisterShalomDto,
    usuarioId?: bigint | null,
  ) {
    if (dto.publicIds.length > MAX_BULK_ORDERS) {
      throw new BadRequestException(
        `El lote admite hasta ${MAX_BULK_ORDERS} envios`,
      );
    }

    const ventas = await this.prisma.venta.findMany({
      where: { empresaId, publicId: { in: dto.publicIds } },
      select: { publicId: true, envio: { select: { dni: true } } },
    });

    const porDocumento = new Map<string, number>();
    for (const venta of ventas) {
      const documento = venta.envio?.dni?.trim();
      if (!documento) continue;
      porDocumento.set(documento, (porDocumento.get(documento) ?? 0) + 1);
    }

    const excedidos = [...porDocumento.entries()].filter(
      ([, total]) => total > MAX_BULK_PER_RECIPIENT,
    );
    if (excedidos.length > 0) {
      throw new BadRequestException(
        `Maximo ${MAX_BULK_PER_RECIPIENT} envios por destinatario en un lote: ${excedidos
          .map(([documento, total]) => `${documento} (${total})`)
          .join(', ')}`,
      );
    }

    const results: Array<{
      publicId: string;
      ok: boolean;
      jobId?: string | null;
      status?: string | null;
      orden?: string | null;
      codigo?: string | null;
      alreadyRegistered?: boolean;
      error?: string;
    }> = [];

    for (const publicId of dto.publicIds) {
      try {
        const result = await this.register(
          empresaId,
          publicId,
          {
            securityKey: dto.securityKey,
            packageType: dto.packageType,
            extraSecurity: dto.extraSecurity,
            cashOnDelivery: dto.cashOnDelivery,
          },
          usuarioId,
        );

        results.push({
          publicId,
          ok: true,
          jobId: result.jobId ?? null,
          status: 'status' in result ? result.status : undefined,
          orden: 'orden' in result ? (result.orden ?? null) : null,
          codigo: 'codigo' in result ? (result.codigo ?? null) : null,
          alreadyRegistered: result.alreadyRegistered,
        });
      } catch (error) {
        results.push({
          publicId,
          ok: false,
          error:
            error instanceof HttpException
              ? error.message
              : error instanceof Error
                ? error.message
                : 'Error desconocido',
        });
      }
    }

    const ok = results.filter((item) => item.ok).length;

    return {
      results,
      totals: { ok, failed: results.length - ok, total: results.length },
    };
  }

  async status(empresaId: bigint, publicId: string) {
    const venta = await this.integration.requireEnvio(empresaId, publicId);
    const envio = venta.envio!;

    return {
      jobId: envio.shalomJobId,
      orden: envio.shalomOrden,
      origen: envio.shalomOrigen,
      destino: envio.agenciaNombre,
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

    let tracking: TrackingResponse;
    try {
      tracking = await this.client.track<TrackingResponse>(
        envio.shalomOrden,
        envio.shalomCodigo ?? undefined,
        credentials.apiKey,
      );
    } catch (error) {
      if (error instanceof ShalomApiError && isGuideGone(error)) {
        return this.markExpiredFromTracking(empresaId, publicId, envio.id);
      }
      throw error;
    }

    if (!tracking?.status) {
      return this.markExpiredFromTracking(empresaId, publicId, envio.id);
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

  /** La guia ya no existe en Shalom: se trata como vencida/anulada. */
  private async markExpiredFromTracking(
    empresaId: bigint,
    publicId: string,
    ventaEnvioId: bigint,
  ) {
    await this.applyTrackingStatus(
      ventaEnvioId,
      { status: 'ANULADO', label: 'Guía vencida', progress: 0 },
      null,
    );
    await this.markGuideCanceled(ventaEnvioId, 'Guía vencida');
    await this.integration.markSynced(empresaId);

    return {
      ...(await this.status(empresaId, publicId)),
      message:
        'La guía ya no existe en Shalom (vencida o anulada). Genera una nueva.',
    };
  }

  /** Sincroniza el resultado del job cuando el webhook no llego. */
  async sync(empresaId: bigint, publicId: string) {
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
      await this.applyRegistration(envio.id, {
        orden: job.result.orden,
        codigo: job.result.codigo ?? null,
        monto: job.result.monto ?? null,
        estado: 'REGISTRADO',
      });
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
   * La guia confirmada se despacha de inmediato: el envio pasa a EN_TRANSITO
   * y deja la bandeja de pendientes. Si la guia se anula antes de que Shalom
   * la recepcione, el despacho se revierte.
   */
  async applyRegistration(
    ventaEnvioId: bigint,
    data: {
      orden: string;
      codigo: string | null;
      monto: number | null;
      estado: string;
    },
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

    const alreadyDispatched =
      updated.estadoLogistico === VentaEnvioEstadoLogistico.EN_TRANSITO ||
      updated.estadoLogistico === VentaEnvioEstadoLogistico.ENTREGADO ||
      updated.estadoLogistico === VentaEnvioEstadoLogistico.INCIDENCIA;

    if (!alreadyDispatched) {
      await this.autoDispatch(ventaEnvioId, data.orden, null);
    }

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

    const wasPending =
      envio.estadoLogistico === VentaEnvioEstadoLogistico.POR_PREPARAR ||
      envio.estadoLogistico === VentaEnvioEstadoLogistico.POR_DESPACHAR;

    // Shalom ya movio el paquete: se recuerda para no revertir el despacho
    // si la guia se anula despues.
    if (
      !envio.shalomRecibidoEn &&
      ['EN_ORIGEN', 'EN_TRANSITO', 'ENTREGADO'].includes(remote.status)
    ) {
      data.shalomRecibidoEn = new Date();
    }

    const applies =
      Boolean(estadoLogistico) &&
      canAdvanceLogistics(envio.estadoLogistico, estadoLogistico!);

    if (applies) {
      data.estadoLogistico = estadoLogistico;
      if (estadoLogistico === VentaEnvioEstadoLogistico.ENTREGADO) {
        data.entregadoAt = new Date();
      }
    }

    const updated = await this.prisma.ventaEnvio.update({
      where: { id: ventaEnvioId },
      data,
    });

    if (applies) {
      await this.prisma.ventaEnvioHistorial.create({
        data: {
          ventaEnvioId,
          estadoAnterior: envio.estadoLogistico,
          estadoNuevo: estadoLogistico!,
          detalle: `Shalom: ${remote.label}`.slice(0, 500),
        },
      });
    }

    // La agencia recepciono el paquete: recien aqui se marca como despachado.
    if (remote.status === 'EN_ORIGEN' && wasPending && envio.shalomOrden) {
      await this.autoDispatch(ventaEnvioId, envio.shalomOrden, null);
    }

    return updated;
  }

  /**
   * Guia anulada o vencida en Shalom.
   *
   * - Si aun no se despacho: vuelve a pendiente y se habilita una nueva guia.
   * - Si ya se despacho: no se retrocede; se marca incidencia.
   */
  async markGuideCanceled(ventaEnvioId: bigint, label: string) {
    const envio = await this.prisma.ventaEnvio.findUnique({
      where: { id: ventaEnvioId },
      include: { venta: { select: { empresaId: true, publicId: true } } },
    });
    if (!envio) return;

    const dispatched =
      envio.estadoLogistico === VentaEnvioEstadoLogistico.EN_TRANSITO ||
      envio.estadoLogistico === VentaEnvioEstadoLogistico.ENTREGADO ||
      envio.estadoLogistico === VentaEnvioEstadoLogistico.INCIDENCIA;

    // Shalom ya recepciono el paquete: la anulacion es una incidencia real.
    if (dispatched && envio.shalomRecibidoEn) {
      if (envio.estadoLogistico !== VentaEnvioEstadoLogistico.INCIDENCIA) {
        await this.prisma.ventaEnvio.update({
          where: { id: ventaEnvioId },
          data: {
            estadoLogistico: VentaEnvioEstadoLogistico.INCIDENCIA,
            shalomEstadoLabel: label?.slice(0, 80) ?? 'Guía anulada',
          },
        });
        await this.prisma.ventaEnvioHistorial.create({
          data: {
            ventaEnvioId,
            estadoAnterior: envio.estadoLogistico,
            estadoNuevo: VentaEnvioEstadoLogistico.INCIDENCIA,
            detalle:
              `Shalom: ${label} (guía anulada después del despacho)`.slice(
                0,
                500,
              ),
          },
        });
      }
      return;
    }

    // La guia nunca llego a la agencia: se deshace el despacho automatico.
    if (dispatched) {
      try {
        await this.sales.revertShalomDispatch(
          envio.venta.empresaId,
          envio.venta.publicId,
          { orden: envio.shalomOrden },
        );
      } catch (error) {
        this.logger.warn(
          `No se pudo revertir el despacho del envio ${envio.venta.publicId}: ${
            error instanceof Error ? error.message : 'error desconocido'
          }`,
        );
      }
    }

    const reference = [envio.shalomOrden, envio.shalomCodigo]
      .filter(Boolean)
      .join(' / ');

    await this.prisma.ventaEnvio.update({
      where: { id: ventaEnvioId },
      data: {
        shalomJobId: null,
        shalomOrden: null,
        shalomCodigo: null,
        shalomMonto: null,
        shalomEstado: null,
        shalomEstadoLabel: null,
        shalomProgreso: null,
        shalomTimeline: Prisma.DbNull,
        shalomRegistradoAt: null,
        shalomRecibidoEn: null,
        shalomSyncAt: new Date(),
        shalomError: `Guía vencida${
          reference ? ` (${reference})` : ''
        }: genera una nueva guía en Shalom`.slice(0, 500),
      },
    });

    await this.prisma.ventaEnvioHistorial.create({
      data: {
        ventaEnvioId,
        estadoAnterior: envio.estadoLogistico,
        estadoNuevo: envio.estadoLogistico,
        detalle: `Guía vencida/anulada en Shalom${
          reference ? `: ${reference}` : ''
        }`.slice(0, 500),
      },
    });
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
      nombres: string | null;
      apellidoPaterno: string | null;
      apellidoMaterno: string | null;
      celular: string | null;
      estadoLogistico: VentaEnvioEstadoLogistico;
    },
    data: {
      documento: string;
      tipoDocumento: string;
      nombre: string | null;
      nombres: string | null;
      apellidoPaterno: string | null;
      apellidoMaterno: string | null;
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
    if (data.nombres && data.nombres !== envio.nombres) {
      updates.nombres = data.nombres.slice(0, 100);
    }
    if (data.apellidoPaterno && data.apellidoPaterno !== envio.apellidoPaterno) {
      updates.apellidoPaterno = data.apellidoPaterno.slice(0, 100);
    }
    if (data.apellidoMaterno && data.apellidoMaterno !== envio.apellidoMaterno) {
      updates.apellidoMaterno = data.apellidoMaterno.slice(0, 100);
    }
    if (data.celular && data.celular !== envio.celular) {
      updates.celular = data.celular;
      changed.push('celular');
    }

    if (Object.keys(updates).length === 0) return;
    if (changed.length === 0) changed.push('nombres');

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

/** Orden del flujo logistico: el rastreo nunca debe retroceder un estado. */
const LOGISTICS_ORDER: Record<VentaEnvioEstadoLogistico, number> = {
  POR_PREPARAR: 1,
  POR_DESPACHAR: 2,
  EN_TRANSITO: 3,
  ENTREGADO: 4,
  INCIDENCIA: 5,
};

export function canAdvanceLogistics(
  current: VentaEnvioEstadoLogistico,
  next: VentaEnvioEstadoLogistico,
) {
  if (current === next) return false;
  if (next === VentaEnvioEstadoLogistico.INCIDENCIA) return true;
  if (current === VentaEnvioEstadoLogistico.INCIDENCIA) return false;
  return LOGISTICS_ORDER[next] > LOGISTICS_ORDER[current];
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

/** Shalom respondio que la guia no existe o esta fuera de la ventana de 24 h. */
function isGuideGone(error: ShalomApiError) {
  if (error.status === 404 || error.status === 410 || error.status === 422) {
    return true;
  }
  return /expirad|no devolvio resultados|no existe|anulad|vencid/i.test(
    error.message,
  );
}
