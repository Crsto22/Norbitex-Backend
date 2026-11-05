import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingEnvironment, PlataformaComprobanteTipo } from '@prisma/client';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingApiClientService } from '../billing-integration/billing-api-client.service';
import { UpdateBillingCredentialsDto } from '../billing-integration/dto/billing-config.dto';

type RemoteTenant = { id: string; ruc: string };
type RemoteApplication = { id: string; code: string };
type RemoteApiKey = { apiKey: string };
type RemoteEstablishment = { id: string; code: string };
type RemoteSeries = {
  id: string;
  series: string;
  environment: BillingEnvironment;
  documentType: 'RECEIPT' | 'INVOICE' | 'CREDIT_NOTE';
  applicationId: string;
  establishmentId: string;
  currentNumber: number;
  active: boolean;
};
type RemoteWebhook = {
  id: string;
  url: string;
  events?: string[];
  signingSecret?: string;
};

const PLATFORM_WEBHOOK_EVENTS = [
  'document.processing',
  'document.accepted',
  'document.accepted_with_observations',
  'document.rejected',
  'document.retry_scheduled',
  'document.failed',
  'sunat_void.accepted',
  'sunat_void.rejected',
  'sunat_void.failed',
];

@Injectable()
export class PlatformBillingIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly api: BillingApiClientService,
    private readonly crypto: SecretsCryptoService,
    private readonly config: ConfigService,
  ) {}

  async status() {
    const config = await this.configRow();
    const environment = toBillingEnvironment(config.ambiente);
    const mappingCount = await this.prisma.platformBillingSeriesMapping.count({
      where: { environment },
    });
    return {
      enabled: config.billingMicroserviceEnabled,
      configured: config.billingStatus === 'READY',
      environment,
      tenantId: config.billingTenantId,
      applicationId: config.billingApplicationId,
      establishmentId: config.billingEstablishmentId,
      status: config.billingStatus,
      lastError: config.billingLastError,
      lastSyncedAt: config.billingLastSyncedAt,
      apiKeys: {
        BETA: Boolean(config.billingBetaApiKeyEncrypted),
        PRODUCTION: Boolean(config.billingProductionApiKeyEncrypted),
      },
      webhooks: {
        BETA: Boolean(config.billingBetaWebhookSecretEncrypted),
        PRODUCTION: Boolean(config.billingProductionWebhookSecretEncrypted),
      },
      credentials: {
        BETA: config.billingBetaCredentialsConfigured,
        PRODUCTION: config.billingProductionCredentialsConfigured,
      },
      certificates: {
        BETA: config.billingBetaCertificateConfigured,
        PRODUCTION: config.billingProductionCertificateConfigured,
      },
      series: mappingCount,
    };
  }

  async provision(environment: BillingEnvironment) {
    const current = await this.configRow();
    if (!current.ruc || !/^\d{11}$/.test(current.ruc)) {
      throw new BadRequestException('Configura un RUC valido para Nuvex');
    }
    if (!current.razonSocial?.trim()) {
      throw new BadRequestException('Configura la razon social de Nuvex');
    }
    if (!current.direccion?.trim() || !/^\d{6}$/.test(current.ubigeo ?? '')) {
      throw new BadRequestException('Configura direccion y ubigeo de Nuvex');
    }
    await this.prisma.configuracionFacturacionPlataforma.update({
      where: { id: 1 },
      data: { billingStatus: 'PENDING', billingLastError: null },
    });
    try {
      const tenant = await this.ensureTenant(current);
      const application = await this.ensureApplication(tenant.id);
      const establishment = await this.ensureEstablishment(tenant.id, current);
      await this.prisma.configuracionFacturacionPlataforma.update({
        where: { id: 1 },
        data: {
          billingTenantId: tenant.id,
          billingApplicationId: application.id,
          billingEstablishmentId: establishment.id,
        },
      });
      const apiKey = await this.ensureApiKey(application.id, environment);
      await this.syncSeries(
        tenant.id,
        application.id,
        establishment.id,
        environment,
      );
      await this.ensureWebhook(apiKey, environment);
      await this.prisma.configuracionFacturacionPlataforma.update({
        where: { id: 1 },
        data: {
          billingStatus: 'READY',
          billingLastError: null,
          billingLastSyncedAt: new Date(),
        },
      });
      return this.status();
    } catch (error) {
      await this.prisma.configuracionFacturacionPlataforma.update({
        where: { id: 1 },
        data: {
          billingStatus: 'ERROR',
          billingLastError: safeMessage(error),
          billingLastSyncedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async syncConfigured() {
    const config = await this.configRow();
    if (!config.billingTenantId || !config.billingApplicationId) {
      return { status: 'SKIPPED' as const };
    }
    await this.provision(toBillingEnvironment(config.ambiente));
    return { status: 'SYNCED' as const };
  }

  async updateCredentials(
    environment: BillingEnvironment,
    dto: UpdateBillingCredentialsDto,
  ) {
    const config = await this.requiredConfig();
    const result = await this.api.admin(
      `/admin/tenants/${config.billingTenantId}/sunat-credentials/${environment}`,
      { method: 'PUT', body: JSON.stringify(dto) },
    );
    if (dto.solUsername && dto.solPassword) {
      await this.prisma.configuracionFacturacionPlataforma.update({
        where: { id: 1 },
        data:
          environment === BillingEnvironment.BETA
            ? { billingBetaCredentialsConfigured: true }
            : { billingProductionCredentialsConfigured: true },
      });
    }
    return result;
  }

  async uploadCertificate(
    environment: BillingEnvironment,
    password: string,
    file: Express.Multer.File,
  ) {
    const config = await this.requiredConfig();
    const form = new FormData();
    form.set('password', password);
    form.set(
      'certificate',
      new Blob([Uint8Array.from(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );
    const result = await this.api.admin(
      `/admin/tenants/${config.billingTenantId}/sunat-credentials/${environment}/certificate`,
      { method: 'PUT', body: form },
    );
    await this.prisma.configuracionFacturacionPlataforma.update({
      where: { id: 1 },
      data:
        environment === BillingEnvironment.BETA
          ? { billingBetaCertificateConfigured: true }
          : { billingProductionCertificateConfigured: true },
    });
    return result;
  }

  async deleteCertificate(environment: BillingEnvironment) {
    const config = await this.requiredConfig();
    const result = await this.api.admin(
      `/admin/tenants/${config.billingTenantId}/sunat-credentials/${environment}/certificate`,
      { method: 'DELETE' },
    );
    await this.prisma.configuracionFacturacionPlataforma.update({
      where: { id: 1 },
      data:
        environment === BillingEnvironment.BETA
          ? { billingBetaCertificateConfigured: false }
          : { billingProductionCertificateConfigured: false },
    });
    return result;
  }

  async setEnabled(enabled: boolean) {
    if (!enabled) {
      await this.prisma.configuracionFacturacionPlataforma.updateMany({
        data: { billingMicroserviceEnabled: false },
      });
      return this.status();
    }
    const config = await this.requiredConfig();
    if (enabled) {
      const globallyAllowed =
        this.config
          .get<string>('PLATFORM_BILLING_MICROSERVICE_ENABLED')
          ?.toLowerCase() === 'true';
      if (!globallyAllowed) {
        throw new BadRequestException(
          'PLATFORM_BILLING_MICROSERVICE_ENABLED no esta habilitado',
        );
      }
      const environment = toBillingEnvironment(config.ambiente);
      const credentials =
        environment === BillingEnvironment.BETA
          ? config.billingBetaCredentialsConfigured &&
            config.billingBetaCertificateConfigured
          : config.billingProductionCredentialsConfigured &&
            config.billingProductionCertificateConfigured;
      if (config.billingStatus !== 'READY' || !credentials) {
        throw new BadRequestException(
          'Aprovisiona Billing y configura credenciales y certificado antes de activarlo',
        );
      }
    }
    await this.prisma.configuracionFacturacionPlataforma.update({
      where: { id: 1 },
      data: { billingMicroserviceEnabled: enabled },
    });
    return this.status();
  }

  async apiKey(environment: BillingEnvironment) {
    const config = await this.requiredConfig();
    const encrypted =
      environment === BillingEnvironment.BETA
        ? config.billingBetaApiKeyEncrypted
        : config.billingProductionApiKeyEncrypted;
    if (!encrypted) throw new BadRequestException('No existe API key Billing');
    return this.crypto.decrypt(encrypted);
  }

  async webhookSecret(environment: BillingEnvironment) {
    const config = await this.requiredConfig();
    const encrypted =
      environment === BillingEnvironment.BETA
        ? config.billingBetaWebhookSecretEncrypted
        : config.billingProductionWebhookSecretEncrypted;
    if (!encrypted) throw new BadRequestException('Webhook no configurado');
    return this.crypto.decrypt(encrypted);
  }

  private async ensureTenant(
    config: Awaited<ReturnType<typeof this.configRow>>,
  ) {
    const all = await this.api.admin<RemoteTenant[]>('/admin/tenants');
    const existing = all.find((item) => item.ruc === config.ruc);
    if (existing) return existing;
    return this.api.admin<RemoteTenant>('/admin/tenants', {
      method: 'POST',
      body: JSON.stringify({
        ruc: config.ruc,
        legalName: config.razonSocial,
        tradeName: config.nombreComercial,
        address: config.direccion,
        ubigeo: config.ubigeo,
      }),
    });
  }

  private async ensureApplication(tenantId: string) {
    const all = await this.api.admin<RemoteApplication[]>(
      `/admin/tenants/${tenantId}/applications`,
    );
    const existing = all.find((item) => item.code === 'nuvex-platform');
    if (existing) return existing;
    return this.api.admin<RemoteApplication>(
      `/admin/tenants/${tenantId}/applications`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Nuvex Platform',
          code: 'nuvex-platform',
        }),
      },
    );
  }

  private async ensureEstablishment(
    tenantId: string,
    config: Awaited<ReturnType<typeof this.configRow>>,
  ) {
    const all = await this.api.admin<RemoteEstablishment[]>(
      `/admin/tenants/${tenantId}/establishments`,
    );
    const existing = all.find((item) => item.code === '0000');
    if (existing) return existing;
    return this.api.admin<RemoteEstablishment>(
      `/admin/tenants/${tenantId}/establishments`,
      {
        method: 'POST',
        body: JSON.stringify({
          code: '0000',
          name: config.nombreComercial || config.razonSocial,
          address: config.direccion,
          ubigeo: config.ubigeo,
        }),
      },
    );
  }

  private async ensureApiKey(
    applicationId: string,
    environment: BillingEnvironment,
  ) {
    const config = await this.configRow();
    const encrypted =
      environment === BillingEnvironment.BETA
        ? config.billingBetaApiKeyEncrypted
        : config.billingProductionApiKeyEncrypted;
    if (encrypted) return this.crypto.decrypt(encrypted);
    const created = await this.api.admin<RemoteApiKey>(
      `/admin/applications/${applicationId}/api-keys`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: `Nuvex Platform ${environment}`,
          environment,
          scopes: [
            'calculations:write',
            'documents:read',
            'documents:write',
            'webhooks:manage',
          ],
        }),
      },
    );
    await this.prisma.configuracionFacturacionPlataforma.update({
      where: { id: 1 },
      data:
        environment === BillingEnvironment.BETA
          ? { billingBetaApiKeyEncrypted: this.crypto.encrypt(created.apiKey) }
          : {
              billingProductionApiKeyEncrypted: this.crypto.encrypt(
                created.apiKey,
              ),
            },
    });
    return created.apiKey;
  }

  private async syncSeries(
    tenantId: string,
    applicationId: string,
    establishmentId: string,
    environment: BillingEnvironment,
  ) {
    const local = await this.prisma.serieComprobantePlataforma.findMany({
      where: {
        activo: true,
        tipo: { in: ['boleta', 'factura', 'nota_credito'] },
      },
    });
    const remote = await this.api.admin<RemoteSeries[]>(
      `/admin/tenants/${tenantId}/fiscal-series`,
    );
    for (const series of local) {
      const documentType = platformDocumentType(series.tipo);
      let fiscal = remote.find(
        (item) =>
          item.series === series.serie &&
          item.environment === environment &&
          item.documentType === documentType,
      );
      if (!fiscal) {
        fiscal = await this.api.admin<RemoteSeries>(
          `/admin/tenants/${tenantId}/fiscal-series`,
          {
            method: 'POST',
            body: JSON.stringify({
              applicationId,
              establishmentId,
              environment,
              documentType,
              series: series.serie,
              initialNumber: series.correlativo,
            }),
          },
        );
      } else if (
        fiscal.applicationId !== applicationId ||
        fiscal.establishmentId !== establishmentId ||
        !fiscal.active ||
        fiscal.currentNumber < series.correlativo
      ) {
        fiscal = await this.api.admin<RemoteSeries>(
          `/admin/tenants/${tenantId}/fiscal-series/${fiscal.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              applicationId,
              establishmentId,
              active: true,
              minimumNumber: series.correlativo,
            }),
          },
        );
      }
      await this.prisma.platformBillingSeriesMapping.upsert({
        where: {
          serieId_environment: { serieId: series.id, environment },
        },
        create: {
          serieId: series.id,
          environment,
          billingFiscalSeriesId: fiscal.id,
        },
        update: { billingFiscalSeriesId: fiscal.id },
      });
    }
  }

  private async ensureWebhook(apiKey: string, environment: BillingEnvironment) {
    const url = this.config
      .get<string>('BILLING_PLATFORM_WEBHOOK_PUBLIC_URL')
      ?.trim();
    if (!url) {
      throw new BadRequestException(
        'BILLING_PLATFORM_WEBHOOK_PUBLIC_URL no esta configurada',
      );
    }
    const hooks = await this.api.application<RemoteWebhook[]>(
      '/webhook-endpoints',
      apiKey,
    );
    let hook = hooks.find((item) => item.url === url);
    if (!hook) {
      hook = await this.api.application<RemoteWebhook>(
        '/webhook-endpoints',
        apiKey,
        {
          method: 'POST',
          body: JSON.stringify({ url, events: PLATFORM_WEBHOOK_EVENTS }),
        },
      );
    } else {
      hook = await this.api.application<RemoteWebhook>(
        `/webhook-endpoints/${hook.id}`,
        apiKey,
        {
          method: 'PATCH',
          body: JSON.stringify({
            url,
            events: PLATFORM_WEBHOOK_EVENTS,
            active: true,
          }),
        },
      );
    }
    if (!hook.signingSecret) {
      hook = await this.api.application<RemoteWebhook>(
        `/webhook-endpoints/${hook.id}/rotate-secret`,
        apiKey,
        { method: 'POST' },
      );
    }
    if (!hook.signingSecret) {
      throw new BadRequestException('Billing no devolvio el secreto webhook');
    }
    await this.prisma.configuracionFacturacionPlataforma.update({
      where: { id: 1 },
      data:
        environment === BillingEnvironment.BETA
          ? {
              billingBetaWebhookEndpointId: hook.id,
              billingBetaWebhookSecretEncrypted: this.crypto.encrypt(
                hook.signingSecret,
              ),
            }
          : {
              billingProductionWebhookEndpointId: hook.id,
              billingProductionWebhookSecretEncrypted: this.crypto.encrypt(
                hook.signingSecret,
              ),
            },
    });
  }

  private configRow() {
    return this.prisma.configuracionFacturacionPlataforma.findUniqueOrThrow({
      where: { id: 1 },
    });
  }

  private async requiredConfig() {
    const config = await this.configRow();
    if (!config.billingTenantId || !config.billingApplicationId) {
      throw new NotFoundException('El emisor Nuvex aun no esta provisionado');
    }
    return config;
  }
}

export function toBillingEnvironment(value: string) {
  return value === 'PRODUCCION'
    ? BillingEnvironment.PRODUCTION
    : BillingEnvironment.BETA;
}

function platformDocumentType(type: PlataformaComprobanteTipo) {
  const map = {
    boleta: 'RECEIPT',
    factura: 'INVOICE',
    nota_credito: 'CREDIT_NOTE',
  } as const;
  if (type === PlataformaComprobanteTipo.nota_venta) {
    throw new BadRequestException('La nota de venta no tiene serie fiscal');
  }
  return map[type];
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1000,
  );
}
