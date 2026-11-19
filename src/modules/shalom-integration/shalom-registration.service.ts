import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VentaEnvioEstadoLogistico } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
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

@Injectable()
export class ShalomRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integration: ShalomIntegrationService,
    private readonly client: ShalomApiClientService,
  ) {}

  /** Encola el registro de la guia en shalom-service. */
  async register(empresaId: bigint, publicId: string, dto: RegisterShalomDto) {
    const venta = await this.integration.requireEnvio(empresaId, publicId);
    const envio = venta.envio!;

    if (!envio.dni) {
      throw new BadRequestException('El envio no tiene documento del destinatario');
    }
    if (envio.shalomOrden) {
      return {
        alreadyRegistered: true,
        orden: envio.shalomOrden,
        codigo: envio.shalomCodigo,
        jobId: envio.shalomJobId,
      };
    }

    const credentials = await this.integration.requireCredentials(empresaId);
    const exportConfig = await this.prisma.empresaShalomExportConfig.findUnique({
      where: { empresaId },
    });

    const originAgency = exportConfig?.origen?.trim();
    if (!originAgency) {
      throw new BadRequestException(
        'Configura la agencia de origen en los ajustes de exportacion Shalom',
      );
    }

    const destinationAgency = envio.agenciaNombre?.trim();
    if (!destinationAgency) {
      throw new BadRequestException('El envio no tiene agencia destino');
    }

    const payload = {
      externalRef: envio.codigoPublico,
      recipientDocument: envio.dni,
      originAgency,
      destinationAgency,
      packageType: dto.packageType ?? credentials.defaultPackageType,
      securityKey: dto.securityKey,
      extraSecurity: dto.extraSecurity ?? false,
      cashOnDelivery: dto.cashOnDelivery ?? false,
    };

    try {
      const job = await this.client.registerOrder<{ jobId: string; status: string }>(
        credentials.tenantId,
        credentials.apiKey,
        payload,
        `envio:${envio.codigoPublico}`,
      );

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
      const message = error instanceof Error ? error.message : 'Error desconocido';
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
  async sync(empresaId: bigint, publicId: string) {
    const venta = await this.integration.requireEnvio(empresaId, publicId);
    const envio = venta.envio!;

    if (!envio.shalomJobId) {
      throw new BadRequestException('El envio no tiene un job de Shalom');
    }

    const credentials = await this.integration.requireCredentials(empresaId);
    const job = await this.client.getJob<JobResponse>(envio.shalomJobId, credentials.apiKey);

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
    }

    return this.status(empresaId, publicId);
  }

  /** Aplica el resultado del registro (usado por sync y por webhook). */
  async applyRegistration(
    ventaEnvioId: bigint,
    data: { orden: string; codigo: string | null; monto: number | null; estado: string },
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

    return updated;
  }

  /** Aplica un cambio de estado del rastreo. */
  async applyTrackingStatus(
    ventaEnvioId: bigint,
    remote: { status: string; label: string; progress: number },
    estadoLogistico: VentaEnvioEstadoLogistico | null,
  ) {
    const envio = await this.prisma.ventaEnvio.findUnique({ where: { id: ventaEnvioId } });
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
}
