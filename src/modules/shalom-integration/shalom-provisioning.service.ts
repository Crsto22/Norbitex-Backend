import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ShalomIntegrationStatus } from '@prisma/client';

import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ShalomApiClientService } from './shalom-api-client.service';
import type { ProvisionShalomProDto } from './dto/shalom-config.dto';

type RemoteTenant = {
  tenantId: string;
  applicationId: string;
  apiKey: string;
  apiKeyPrefix?: string;
};

type RemoteValidation = {
  valid: boolean;
  status: string;
  outcome?: string | null;
  message?: string | null;
};

export type ShalomProStatus = {
  connected: boolean;
  tenantId: string | null;
  applicationId: string | null;
  status: ShalomIntegrationStatus | 'SIN_CONECTAR';
  defaultPackageType: string | null;
  hasWebhook: boolean;
  lastError: string | null;
  lastSyncedAt: Date | null;
  valid?: boolean;
  message?: string | null;
};

/**
 * Conexion de la cuenta de Shalom PRO de la empresa.
 *
 * - Crea el tenant + aplicacion + API key en shalom-service (admin key).
 * - Guarda la API key y el secreto del webhook cifrados.
 * - NO guarda la contrasena de Shalom en Nuvex.
 */
@Injectable()
export class ShalomProvisioningService {
  private readonly logger = new Logger(ShalomProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretsCryptoService,
    private readonly client: ShalomApiClientService,
    private readonly config: ConfigService,
  ) {}

  async status(empresaId: bigint): Promise<ShalomProStatus> {
    const integration = await this.prisma.shalomIntegration.findUnique({
      where: { empresaId },
    });

    if (!integration) {
      return {
        connected: false,
        tenantId: null,
        applicationId: null,
        status: 'SIN_CONECTAR',
        defaultPackageType: null,
        hasWebhook: false,
        lastError: null,
        lastSyncedAt: null,
      };
    }

    return {
      connected: true,
      tenantId: integration.tenantId,
      applicationId: integration.applicationId,
      status: integration.status,
      defaultPackageType: integration.defaultPackageType,
      hasWebhook: Boolean(integration.webhookSecretEncrypted),
      lastError: integration.lastError,
      lastSyncedAt: integration.lastSyncedAt,
    };
  }

  async provision(empresaId: bigint, dto: ProvisionShalomProDto): Promise<ShalomProStatus> {
    const adminKey = this.adminKey();
    const empresa = await this.prisma.empresa.findUnique({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    const existing = await this.prisma.shalomIntegration.findUnique({ where: { empresaId } });

    if (existing) {
      // Ya conectada: se actualizan las credenciales en shalom-service.
      const validation = await this.client.updateCredentials<RemoteValidation>(
        adminKey,
        existing.tenantId,
        { username: dto.username, password: dto.password },
      );

      await this.prisma.shalomIntegration.update({
        where: { empresaId },
        data: {
          status: validation.valid ? 'ACTIVE' : 'ERROR',
          lastError: validation.valid ? null : (validation.message ?? 'Credenciales rechazadas'),
          defaultPackageType: dto.packageType ?? existing.defaultPackageType,
          lastSyncedAt: new Date(),
        },
      });

      return { ...(await this.status(empresaId)), valid: validation.valid, message: validation.message ?? null };
    }

    // Primera conexion: alta en shalom-service.
    const created = await this.client.createTenant<RemoteTenant>(adminKey, {
      code: this.tenantCode(empresa),
      name: empresa.nombreComercial,
      username: dto.username,
      password: dto.password,
    });

    let webhookSecretEncrypted: string | null = null;
    const webhookUrl = this.webhookUrl();
    if (webhookUrl && created.applicationId) {
      try {
        const webhook = await this.client.createWebhook<{ id: string; secret: string }>(
          adminKey,
          created.applicationId,
          { url: webhookUrl, events: ['order.registered'] },
        );
        webhookSecretEncrypted = this.crypto.encrypt(webhook.secret);
      } catch (error) {
        this.logger.warn(
          `No se pudo registrar el webhook de Shalom: ${(error as Error).message}`,
        );
      }
    }

    const validation = await this.client
      .validateCredentials<RemoteValidation>(adminKey, created.tenantId)
      .catch((error: Error) => ({ valid: false, status: 'ERROR', message: error.message }));

    await this.prisma.shalomIntegration.create({
      data: {
        empresaId,
        tenantId: created.tenantId,
        applicationId: created.applicationId,
        apiKeyEncrypted: this.crypto.encrypt(created.apiKey),
        webhookSecretEncrypted,
        defaultPackageType: dto.packageType ?? 'PAQUETE S',
        status: validation.valid ? 'ACTIVE' : 'ERROR',
        lastError: validation.valid ? null : (validation.message ?? 'No se pudo validar la cuenta'),
        lastSyncedAt: new Date(),
      },
    });

    this.logger.log(
      `Shalom PRO conectado para empresa ${empresa.id} (tenant ${created.tenantId}, webhook ${Boolean(webhookSecretEncrypted)})`,
    );

    return { ...(await this.status(empresaId)), valid: validation.valid, message: validation.message ?? null };
  }

  async validate(empresaId: bigint): Promise<ShalomProStatus> {
    const adminKey = this.adminKey();
    const integration = await this.prisma.shalomIntegration.findUnique({ where: { empresaId } });
    if (!integration) {
      throw new BadRequestException('La empresa no tiene Shalom PRO conectado');
    }

    const validation = await this.client.validateCredentials<RemoteValidation>(
      adminKey,
      integration.tenantId,
    );

    await this.prisma.shalomIntegration.update({
      where: { empresaId },
      data: {
        status: validation.valid ? 'ACTIVE' : 'ERROR',
        lastError: validation.valid ? null : (validation.message ?? 'Credenciales rechazadas'),
        lastSyncedAt: new Date(),
      },
    });

    return { ...(await this.status(empresaId)), valid: validation.valid, message: validation.message ?? null };
  }

  private adminKey(): string {
    const key = this.config.get<string>('SHALOM_SERVICE_ADMIN_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'SHALOM_SERVICE_ADMIN_KEY no esta configurada en el backend',
      );
    }
    return key;
  }

  private webhookUrl(): string | null {
    const base = this.config.get<string>('SHALOM_WEBHOOK_PUBLIC_URL')?.trim();
    if (!base) return null;
    return `${base.replace(/\/$/, '')}/shalom/webhooks`;
  }

  private tenantCode(empresa: {
    id: bigint;
    nombreComercial: string;
    ruc: string | null;
  }): string {
    const base = empresa.nombreComercial
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);

    const suffix = empresa.ruc ?? empresa.id.toString();
    return `${base || 'empresa'}-${suffix}`;
  }
}
