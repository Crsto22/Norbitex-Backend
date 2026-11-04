import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingEnvironment, Prisma } from '@prisma/client';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingApiClientService } from './billing-api-client.service';
import {
  UpdateBillingCredentialsDto,
  UploadBillingCertificateDto,
} from './dto/billing-config.dto';

type RemoteTenant = { id: string; ruc: string };
type RemoteApplication = { id: string; code: string };
type RemoteEstablishment = { id: string; code: string };
type RemoteSeries = {
  id: string;
  series: string;
  environment: BillingEnvironment;
  applicationId: string;
  establishmentId: string;
  documentType: 'RECEIPT' | 'INVOICE';
  currentNumber: number;
  active: boolean;
};
type RemoteApiKey = { apiKey: string };
type RemoteWebhook = {
  id: string;
  url: string;
  environment: BillingEnvironment;
  signingSecret?: string;
};

const WEBHOOK_EVENTS = [
  'document.processing',
  'document.accepted',
  'document.accepted_with_observations',
  'document.rejected',
  'document.retry_scheduled',
  'document.failed',
];

@Injectable()
export class BillingIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly api: BillingApiClientService,
    private readonly crypto: SecretsCryptoService,
    private readonly config: ConfigService,
  ) {}

  async getStatus(empresaId: bigint) {
    const company = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        billingMicroserviceEnabled: true,
        billingIntegration: true,
        _count: {
          select: {
            billingEstablishments: true,
            billingSeries: true,
          },
        },
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const integration = company.billingIntegration;
    return {
      enabled: company.billingMicroserviceEnabled,
      configured: integration?.status === 'READY',
      environment: integration?.environment ?? 'BETA',
      tenantId: integration?.tenantId ?? null,
      applicationId: integration?.applicationId ?? null,
      status: integration?.status ?? 'PENDING',
      lastError: integration?.lastError ?? null,
      lastSyncedAt: integration?.lastSyncedAt ?? null,
      apiKeys: {
        BETA: Boolean(integration?.betaApiKeyEncrypted),
        PRODUCTION: Boolean(integration?.productionApiKeyEncrypted),
      },
      webhooks: {
        BETA: Boolean(integration?.betaWebhookSecretEncrypted),
        PRODUCTION: Boolean(integration?.productionWebhookSecretEncrypted),
      },
      credentials: {
        BETA: Boolean(integration?.betaCredentialsConfigured),
        PRODUCTION: Boolean(integration?.productionCredentialsConfigured),
      },
      certificates: {
        BETA: Boolean(integration?.betaCertificateConfigured),
        PRODUCTION: Boolean(integration?.productionCertificateConfigured),
      },
      establishments: company._count.billingEstablishments,
      series: company._count.billingSeries,
    };
  }

  async syncConfigured(empresaId: bigint) {
    const integration = await this.prisma.billingIntegration.findUnique({
      where: { empresaId },
      select: { environment: true, tenantId: true, applicationId: true },
    });
    if (!integration?.tenantId || !integration.applicationId) {
      return { status: 'SKIPPED' as const };
    }
    await this.provision(empresaId, integration.environment);
    return { status: 'SYNCED' as const };
  }

  async provision(empresaId: bigint, environment: BillingEnvironment) {
    const company = await this.companyForProvisioning(empresaId);
    if (!company.ruc || !/^\d{11}$/.test(company.ruc)) {
      throw new BadRequestException('La empresa debe tener un RUC valido');
    }
    if (!company.razonSocial?.trim()) {
      throw new BadRequestException('La empresa debe tener razon social');
    }
    const principal =
      company.sucursales.find((branch) => branch.esPrincipal) ??
      company.sucursales[0];
    if (!principal) {
      throw new BadRequestException('Configura una sucursal activa');
    }

    await this.prisma.billingIntegration.upsert({
      where: { empresaId },
      create: { empresaId, environment, status: 'PENDING' },
      update: { environment, status: 'PENDING', lastError: null },
    });

    try {
      const tenant = await this.ensureTenant(company, principal);
      const application = await this.ensureApplication(tenant.id);
      await this.prisma.billingIntegration.update({
        where: { empresaId },
        data: { tenantId: tenant.id, applicationId: application.id },
      });
      const apiKey = await this.ensureApiKey(
        empresaId,
        application.id,
        environment,
      );

      const establishmentMap = new Map<string, RemoteEstablishment>();
      for (const branch of company.sucursales) {
        const establishment = await this.ensureEstablishment(tenant.id, branch);
        establishmentMap.set(branch.id.toString(), establishment);
        await this.prisma.billingEstablishmentMapping.upsert({
          where: {
            sucursalId_environment: { sucursalId: branch.id, environment },
          },
          create: {
            empresaId,
            sucursalId: branch.id,
            environment,
            billingEstablishmentId: establishment.id,
            code: establishment.code,
          },
          update: {
            billingEstablishmentId: establishment.id,
            code: establishment.code,
          },
        });
      }

      for (const series of company.seriesComprobante) {
        const branchId =
          series.sucursales[0]?.sucursalId ?? principal.id;
        const establishment = establishmentMap.get(branchId.toString());
        if (!establishment) continue;
        const fiscalSeries = await this.ensureFiscalSeries(
          tenant.id,
          application.id,
          establishment.id,
          environment,
          {
            ...series,
            tipoComprobante:
              series.tipoComprobante === 'boleta' ? 'boleta' : 'factura',
          },
        );
        await this.prisma.billingSeriesMapping.upsert({
          where: {
            serieComprobanteId_environment: {
              serieComprobanteId: series.id,
              environment,
            },
          },
          create: {
            empresaId,
            serieComprobanteId: series.id,
            environment,
            billingFiscalSeriesId: fiscalSeries.id,
          },
          update: { billingFiscalSeriesId: fiscalSeries.id },
        });
      }

      await this.ensureWebhook(empresaId, apiKey, environment);
      await this.syncLogo(tenant.id, company.logoUrl);
      await this.prisma.billingIntegration.update({
        where: { empresaId },
        data: {
          environment,
          status: 'READY',
          lastError: null,
          lastSyncedAt: new Date(),
        },
      });
      return this.getStatus(empresaId);
    } catch (error) {
      await this.prisma.billingIntegration.update({
        where: { empresaId },
        data: {
          status: 'ERROR',
          lastError: safeMessage(error),
          lastSyncedAt: new Date(),
        },
      });
      throw error;
    }
  }

  async updateCredentials(
    empresaId: bigint,
    environment: BillingEnvironment,
    dto: UpdateBillingCredentialsDto,
  ) {
    const integration = await this.requiredIntegration(empresaId);
    const result = await this.api.admin(
      `/admin/tenants/${integration.tenantId}/sunat-credentials/${environment}`,
      { method: 'PUT', body: JSON.stringify(dto) },
    );
    if (dto.solUsername && dto.solPassword) {
      await this.prisma.billingIntegration.update({
        where: { empresaId },
        data:
          environment === BillingEnvironment.BETA
            ? { betaCredentialsConfigured: true }
            : { productionCredentialsConfigured: true },
      });
    }
    return result;
  }

  async uploadCertificate(
    empresaId: bigint,
    environment: BillingEnvironment,
    dto: UploadBillingCertificateDto,
    file: Express.Multer.File,
  ) {
    const integration = await this.requiredIntegration(empresaId);
    const form = new FormData();
    form.set('password', dto.password);
    form.set(
      'certificate',
      new Blob([Uint8Array.from(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );
    const result = await this.api.admin(
      `/admin/tenants/${integration.tenantId}/sunat-credentials/${environment}/certificate`,
      { method: 'PUT', body: form },
    );
    await this.prisma.billingIntegration.update({
      where: { empresaId },
      data:
        environment === BillingEnvironment.BETA
          ? { betaCertificateConfigured: true }
          : { productionCertificateConfigured: true },
    });
    return result;
  }

  async deleteCertificate(
    empresaId: bigint,
    environment: BillingEnvironment,
  ) {
    const integration = await this.requiredIntegration(empresaId);
    const result = await this.api.admin(
      `/admin/tenants/${integration.tenantId}/sunat-credentials/${environment}/certificate`,
      { method: 'DELETE' },
    );
    await this.prisma.billingIntegration.update({
      where: { empresaId },
      data:
        environment === BillingEnvironment.BETA
          ? { betaCertificateConfigured: false }
          : { productionCertificateConfigured: false },
    });
    return result;
  }

  async setEnabled(empresaId: bigint, enabled: boolean) {
    if (enabled) {
      const integration = await this.requiredIntegration(empresaId);
      if (integration.status !== 'READY') {
        throw new BadRequestException(
          'Completa la configuracion Billing antes de activar la emision',
        );
      }
      const credentialsReady =
        integration.environment === BillingEnvironment.BETA
          ? integration.betaCredentialsConfigured &&
            integration.betaCertificateConfigured
          : integration.productionCredentialsConfigured &&
            integration.productionCertificateConfigured;
      if (!credentialsReady) {
        throw new BadRequestException(
          'Configura credenciales SOL y certificado antes de activar Billing',
        );
      }
      const legacyJobs = await this.prisma.sunatJob.count({
        where: {
          empresaId,
          tipoDocumento: 'venta',
          estado: { in: ['pendiente_envio', 'procesando'] },
        },
      });
      if (legacyJobs > 0) {
        throw new BadRequestException(
          `Hay ${legacyJobs} comprobante(s) pendientes en el emisor SUNAT anterior`,
        );
      }
    }
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { billingMicroserviceEnabled: enabled },
    });
    return this.getStatus(empresaId);
  }

  async apiKey(empresaId: bigint, environment: BillingEnvironment) {
    const integration = await this.requiredIntegration(empresaId);
    const encrypted =
      environment === BillingEnvironment.BETA
        ? integration.betaApiKeyEncrypted
        : integration.productionApiKeyEncrypted;
    if (!encrypted) {
      throw new BadRequestException(
        `No existe API key Billing para ${environment}`,
      );
    }
    return this.crypto.decrypt(encrypted);
  }

  private companyForProvisioning(empresaId: bigint) {
    return this.prisma.empresa.findUniqueOrThrow({
      where: { id: empresaId },
      select: {
        id: true,
        ruc: true,
        razonSocial: true,
        nombreComercial: true,
        direccion: true,
        logoUrl: true,
        sucursales: {
          where: { estado: 'activo', tipo: 'tienda' },
          orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
          select: {
            id: true,
            nombre: true,
            direccion: true,
            ubigeo: true,
            esPrincipal: true,
            codigoEstablecimientoSunat: true,
          },
        },
        seriesComprobante: {
          where: { activo: true, tipoComprobante: { in: ['boleta', 'factura'] } },
          select: {
            id: true,
            serie: true,
            tipoComprobante: true,
            numeroActual: true,
            sucursales: { select: { sucursalId: true } },
          },
        },
      },
    });
  }

  private async ensureTenant(
    company: Awaited<ReturnType<typeof this.companyForProvisioning>>,
    principal: { direccion: string; ubigeo: string },
  ) {
    const tenants = await this.api.admin<RemoteTenant[]>('/admin/tenants');
    const existing = tenants.find((item) => item.ruc === company.ruc);
    if (existing) return existing;
    return this.api.admin<RemoteTenant>('/admin/tenants', {
      method: 'POST',
      body: JSON.stringify({
        ruc: company.ruc,
        legalName: company.razonSocial,
        tradeName: company.nombreComercial,
        address: company.direccion || principal.direccion,
        ubigeo: principal.ubigeo,
      }),
    });
  }

  private async ensureApplication(tenantId: string) {
    const applications = await this.api.admin<RemoteApplication[]>(
      `/admin/tenants/${tenantId}/applications`,
    );
    const existing = applications.find((item) => item.code === 'nuvex');
    if (existing) return existing;
    return this.api.admin<RemoteApplication>(
      `/admin/tenants/${tenantId}/applications`,
      {
        method: 'POST',
        body: JSON.stringify({ name: 'Nuvex SaaS', code: 'nuvex' }),
      },
    );
  }

  private async ensureApiKey(
    empresaId: bigint,
    applicationId: string,
    environment: BillingEnvironment,
  ) {
    const integration = await this.prisma.billingIntegration.findUniqueOrThrow({
      where: { empresaId },
    });
    const encrypted =
      environment === BillingEnvironment.BETA
        ? integration.betaApiKeyEncrypted
        : integration.productionApiKeyEncrypted;
    if (encrypted) return this.crypto.decrypt(encrypted);

    const created = await this.api.admin<RemoteApiKey>(
      `/admin/applications/${applicationId}/api-keys`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: `Nuvex ${environment}`,
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
    await this.prisma.billingIntegration.update({
      where: { empresaId },
      data:
        environment === BillingEnvironment.BETA
          ? { betaApiKeyEncrypted: this.crypto.encrypt(created.apiKey) }
          : { productionApiKeyEncrypted: this.crypto.encrypt(created.apiKey) },
    });
    return created.apiKey;
  }

  private async ensureEstablishment(
    tenantId: string,
    branch: {
      nombre: string;
      direccion: string;
      ubigeo: string;
      codigoEstablecimientoSunat: string | null;
    },
  ) {
    const code = branch.codigoEstablecimientoSunat?.trim() || '0000';
    const establishments = await this.api.admin<RemoteEstablishment[]>(
      `/admin/tenants/${tenantId}/establishments`,
    );
    const existing = establishments.find((item) => item.code === code);
    if (existing) return existing;
    return this.api.admin<RemoteEstablishment>(
      `/admin/tenants/${tenantId}/establishments`,
      {
        method: 'POST',
        body: JSON.stringify({
          code,
          name: branch.nombre,
          address: branch.direccion,
          ubigeo: branch.ubigeo,
        }),
      },
    );
  }

  private async ensureFiscalSeries(
    tenantId: string,
    applicationId: string,
    establishmentId: string,
    environment: BillingEnvironment,
    series: {
      serie: string;
      tipoComprobante: 'boleta' | 'factura';
      numeroActual: number;
    },
  ) {
    const all = await this.api.admin<RemoteSeries[]>(
      `/admin/tenants/${tenantId}/fiscal-series`,
    );
    const documentType =
      series.tipoComprobante === 'boleta' ? 'RECEIPT' : 'INVOICE';
    const existing = all.find(
      (item) =>
        item.series === series.serie &&
        item.environment === environment &&
        item.documentType === documentType,
    );
    if (existing) {
      if (
        existing.applicationId === applicationId &&
        existing.establishmentId === establishmentId &&
        existing.active &&
        existing.currentNumber >= series.numeroActual
      ) {
        return existing;
      }
      return this.api.admin<RemoteSeries>(
        `/admin/tenants/${tenantId}/fiscal-series/${existing.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            applicationId,
            establishmentId,
            active: true,
            minimumNumber: series.numeroActual,
          }),
        },
      );
    }
    return this.api.admin<RemoteSeries>(
      `/admin/tenants/${tenantId}/fiscal-series`,
      {
        method: 'POST',
        body: JSON.stringify({
          applicationId,
          establishmentId,
          environment,
          documentType,
          series: series.serie,
          initialNumber: series.numeroActual,
        }),
      },
    );
  }

  private async ensureWebhook(
    empresaId: bigint,
    apiKey: string,
    environment: BillingEnvironment,
  ) {
    const url = this.config.get<string>('BILLING_WEBHOOK_PUBLIC_URL')?.trim();
    if (!url) {
      throw new BadRequestException(
        'BILLING_WEBHOOK_PUBLIC_URL no esta configurada',
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
          body: JSON.stringify({ url, events: WEBHOOK_EVENTS }),
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
    await this.prisma.billingIntegration.update({
      where: { empresaId },
      data:
        environment === BillingEnvironment.BETA
          ? {
              betaWebhookEndpointId: hook.id,
              betaWebhookSecretEncrypted: this.crypto.encrypt(
                hook.signingSecret,
              ),
            }
          : {
              productionWebhookEndpointId: hook.id,
              productionWebhookSecretEncrypted: this.crypto.encrypt(
                hook.signingSecret,
              ),
            },
    });
  }

  private async syncLogo(tenantId: string, logoUrl: string | null) {
    if (!logoUrl) return;
    try {
      const logo = await this.api.download(logoUrl);
      const form = new FormData();
      form.set(
        'logo',
        new Blob([Uint8Array.from(logo.bytes)], { type: logo.contentType }),
        'logo',
      );
      await this.api.admin(`/admin/tenants/${tenantId}/branding/logo`, {
        method: 'PUT',
        body: form,
      });
    } catch {
      // El branding no bloquea el alta fiscal; se podra resincronizar.
    }
  }

  private async requiredIntegration(empresaId: bigint) {
    const integration = await this.prisma.billingIntegration.findUnique({
      where: { empresaId },
    });
    if (!integration?.tenantId || !integration.applicationId) {
      throw new BadRequestException('La empresa aun no esta provisionada');
    }
    return integration;
  }
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}
