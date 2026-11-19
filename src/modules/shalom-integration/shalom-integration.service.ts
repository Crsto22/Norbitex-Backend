import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateShalomConfigDto } from './dto/shalom-config.dto';

@Injectable()
export class ShalomIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretsCryptoService,
  ) {}

  async getConfig(empresaId: bigint) {
    const config = await this.prisma.shalomIntegration.findUnique({
      where: { empresaId },
    });

    if (!config) {
      return {
        configured: false,
        tenantId: null,
        applicationId: null,
        status: null,
        defaultPackageType: null,
        lastError: null,
        lastSyncedAt: null,
      };
    }

    return {
      configured: true,
      tenantId: config.tenantId,
      applicationId: config.applicationId,
      status: config.status,
      defaultPackageType: config.defaultPackageType,
      hasWebhookSecret: Boolean(config.webhookSecretEncrypted),
      lastError: config.lastError,
      lastSyncedAt: config.lastSyncedAt,
    };
  }

  async updateConfig(empresaId: bigint, dto: UpdateShalomConfigDto) {
    const data = {
      tenantId: dto.tenantId,
      applicationId: dto.applicationId ?? null,
      apiKeyEncrypted: this.crypto.encrypt(dto.apiKey),
      webhookSecretEncrypted: dto.webhookSecret
        ? this.crypto.encrypt(dto.webhookSecret)
        : undefined,
      defaultPackageType: dto.defaultPackageType ?? 'PAQUETE S',
      status: 'ACTIVE' as const,
      lastError: null,
    };

    await this.prisma.shalomIntegration.upsert({
      where: { empresaId },
      create: { empresaId, ...data },
      update: data,
    });

    return this.getConfig(empresaId);
  }

  /** Config lista para usar (descifra la API key). */
  async requireCredentials(empresaId: bigint) {
    const config = await this.prisma.shalomIntegration.findUnique({
      where: { empresaId },
    });

    if (!config) {
      throw new BadRequestException(
        'Shalom no esta configurado para esta empresa',
      );
    }
    if (config.status !== 'ACTIVE') {
      throw new BadRequestException(
        `La integracion de Shalom no esta activa (${config.status})`,
      );
    }

    return {
      tenantId: config.tenantId,
      apiKey: this.crypto.decrypt(config.apiKeyEncrypted),
      defaultPackageType: config.defaultPackageType,
      webhookSecret: config.webhookSecretEncrypted
        ? this.crypto.decrypt(config.webhookSecretEncrypted)
        : null,
    };
  }

  async markError(empresaId: bigint, message: string) {
    await this.prisma.shalomIntegration
      .update({
        where: { empresaId },
        data: { status: 'ERROR', lastError: message.slice(0, 1000) },
      })
      .catch(() => undefined);
  }

  async markSynced(empresaId: bigint) {
    await this.prisma.shalomIntegration.update({
      where: { empresaId },
      data: { lastSyncedAt: new Date(), lastError: null },
    });
  }

  async requireEnvio(empresaId: bigint, publicId: string) {
    const venta = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      include: { envio: true },
    });

    if (!venta) throw new NotFoundException('Venta no encontrada');
    if (!venta.envio) {
      throw new BadRequestException('La venta no tiene envio por courier');
    }
    if (venta.envio.agencia !== 'SHALOM') {
      throw new BadRequestException('El envio no es por Shalom');
    }

    return venta;
  }
}
