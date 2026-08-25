import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmpresaEstado,
  PlanCodigo,
  Prisma,
  SunatAmbiente,
  SunatEndpointCodigo,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { UpdateSunatConfigDto } from '../sunat-config/dto/update-sunat-config.dto';
import { UploadSunatCertificateDto } from '../sunat-config/dto/upload-sunat-certificate.dto';
import { SunatConfigService } from '../sunat-config/sunat-config.service';
import { PlansService } from '../plans/plans.service';
import {
  FindPlatformSunatCompaniesQueryDto,
  UpdatePlatformCompanyFiscalDto,
} from './dto/platform-sunat.dto';

type CompanyWithSunat = {
  id: bigint;
  nombreComercial: string;
  razonSocial: string | null;
  ruc: string | null;
  dni: string | null;
  email: string | null;
  direccion: string | null;
  estado: EmpresaEstado;
  planCodigo: PlanCodigo;
  sunatConfig: {
    ambiente: SunatAmbiente;
    usuarioSolEncrypted: string | null;
    claveSolEncrypted: string | null;
    clientIdEncrypted: string | null;
    clientSecretEncrypted: string | null;
    certificadoPasswordEncrypted: string | null;
    certificadoR2Key: string | null;
    certificadoNombre: string | null;
    certificadoMimeType: string | null;
    certificadoSizeBytes: number | null;
    certificadoUploadedAt: Date | null;
    igvPorcentaje: Prisma.Decimal;
    activo: boolean;
    updatedAt: Date;
  } | null;
};

@Injectable()
export class PlatformSunatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly sunatConfigService: SunatConfigService,
  ) {}

  async findCompanies(query: FindPlatformSunatCompaniesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const search = query.search?.trim();
    const where: Prisma.EmpresaWhereInput = search
      ? {
          OR: [
            { nombreComercial: { contains: search, mode: 'insensitive' } },
            { razonSocial: { contains: search, mode: 'insensitive' } },
            { ruc: { contains: search } },
            { dni: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [companies, total] = await Promise.all([
      this.prisma.empresa.findMany({
        where,
        orderBy: { nombreComercial: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          nombreComercial: true,
          razonSocial: true,
          ruc: true,
          dni: true,
          email: true,
          estado: true,
          planCodigo: true,
        },
      }),
      this.prisma.empresa.count({ where }),
    ]);

    return {
      data: companies.map((company) => ({
        id: company.id.toString(),
        name: company.nombreComercial,
        legalName: company.razonSocial,
        document: company.ruc ?? company.dni,
        email: company.email,
        state: company.estado,
        planCode: company.planCodigo,
        planName: this.plansService.getDefinition(company.planCodigo).name,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findCompany(id: string) {
    const company = await this.findCompanyRecord(this.parseCompanyId(id));
    const endpoints = await this.getEndpointAvailability();

    return this.mapCompanyDetail(company, endpoints);
  }

  async updateFiscal(
    actor: JwtPayload,
    id: string,
    dto: UpdatePlatformCompanyFiscalDto,
  ) {
    const companyId = this.parseCompanyId(id);
    const actorId = BigInt(actor.sub);
    const updated = await this.prisma
      .$transaction(
        async (tx) => {
          const current = await tx.empresa.findUnique({
            where: { id: companyId },
            select: {
              id: true,
              nombreComercial: true,
              razonSocial: true,
              ruc: true,
              direccion: true,
            },
          });
          if (!current) throw new NotFoundException('Empresa no encontrada');

          const data: Prisma.EmpresaUpdateInput = {};
          if (dto.nombreComercial !== undefined) {
            const value = dto.nombreComercial.trim();
            if (!value)
              throw new BadRequestException(
                'El nombre comercial es obligatorio',
              );
            data.nombreComercial = value;
          }
          if (dto.razonSocial !== undefined) {
            data.razonSocial = dto.razonSocial.trim() || null;
          }
          if (dto.ruc !== undefined) {
            const ruc = dto.ruc.trim();
            if (ruc && !/^\d{11}$/.test(ruc)) {
              throw new BadRequestException('El RUC debe tener 11 digitos');
            }
            data.ruc = ruc || null;
            if (ruc) data.dni = null;
          }
          if (dto.direccion !== undefined) {
            data.direccion = dto.direccion.trim() || null;
          }

          const result = await tx.empresa.update({
            where: { id: companyId },
            data,
            select: this.companySelect(),
          });
          await tx.platformAuditLog.create({
            data: {
              empresaId: companyId,
              usuarioId: actorId,
              category: 'company',
              action: 'company_fiscal_data_updated',
              source: 'admin',
              description: `Datos fiscales de ${result.nombreComercial} actualizados`,
              metadata: {
                previous: {
                  id: current.id.toString(),
                  nombreComercial: current.nombreComercial,
                  razonSocial: current.razonSocial,
                  ruc: current.ruc,
                  direccion: current.direccion,
                },
                current: {
                  nombreComercial: result.nombreComercial,
                  razonSocial: result.razonSocial,
                  ruc: result.ruc,
                  direccion: result.direccion,
                },
              },
            },
          });

          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new BadRequestException('El RUC ya esta registrado');
        }
        throw error;
      });
    const endpoints = await this.getEndpointAvailability();

    return this.mapCompanyDetail(updated, endpoints);
  }

  async updateConfig(actor: JwtPayload, id: string, dto: UpdateSunatConfigDto) {
    const companyId = this.parseCompanyId(id);
    await this.sunatConfigService.update(companyId, dto);
    await this.audit(actor, companyId, 'sunat_config_updated');

    return this.findCompany(id);
  }

  async uploadCertificate(
    actor: JwtPayload,
    id: string,
    dto: UploadSunatCertificateDto,
    file: Express.Multer.File,
  ) {
    const companyId = this.parseCompanyId(id);
    await this.sunatConfigService.uploadCertificate(companyId, dto, file);
    await this.audit(actor, companyId, 'sunat_certificate_uploaded');

    return this.findCompany(id);
  }

  async deleteCertificate(actor: JwtPayload, id: string) {
    const companyId = this.parseCompanyId(id);
    await this.sunatConfigService.deleteCertificate(companyId);
    await this.audit(actor, companyId, 'sunat_certificate_deleted');

    return this.findCompany(id);
  }

  private async audit(actor: JwtPayload, empresaId: bigint, action: string) {
    const company = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { nombreComercial: true },
    });

    await this.prisma.platformAuditLog.create({
      data: {
        empresaId,
        usuarioId: BigInt(actor.sub),
        category: 'company',
        action,
        source: 'admin',
        description: `SUNAT de ${company?.nombreComercial ?? 'empresa'} actualizado`,
      },
    });
  }

  private async findCompanyRecord(id: bigint) {
    const company = await this.prisma.empresa.findUnique({
      where: { id },
      select: this.companySelect(),
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');

    return company;
  }

  private async getEndpointAvailability() {
    const active = await this.prisma.sunatEndpointConfig.findMany({
      where: { codigo: SunatEndpointCodigo.BILL_SERVICE, activo: true },
      select: { ambiente: true },
    });
    return new Set(active.map((item) => item.ambiente));
  }

  private mapCompanySummary(
    company: CompanyWithSunat,
    endpoints: Set<SunatAmbiente>,
  ) {
    const readiness = this.buildReadiness(company, endpoints);
    return {
      id: company.id.toString(),
      name: company.nombreComercial,
      legalName: company.razonSocial,
      document: company.ruc ?? company.dni,
      email: company.email,
      state: company.estado,
      planCode: company.planCodigo,
      planName: this.plansService.getDefinition(company.planCodigo).name,
      sunat: this.mapSunatConfig(company),
      readiness,
    };
  }

  private mapCompanyDetail(
    company: CompanyWithSunat,
    endpoints: Set<SunatAmbiente>,
  ) {
    return {
      ...this.mapCompanySummary(company, endpoints),
      fiscal: {
        nombreComercial: company.nombreComercial,
        razonSocial: company.razonSocial,
        ruc: company.ruc,
        dni: company.dni,
        direccion: company.direccion,
      },
    };
  }

  private mapSunatConfig(company: CompanyWithSunat) {
    const config = company.sunatConfig;
    return {
      ambiente: config?.ambiente ?? SunatAmbiente.BETA,
      igvPorcentaje: config?.igvPorcentaje.toFixed(2) ?? '18.00',
      activo: config?.activo ?? false,
      usuarioSolConfigurado: Boolean(config?.usuarioSolEncrypted),
      claveSolConfigurada: Boolean(config?.claveSolEncrypted),
      clientIdConfigurado: Boolean(config?.clientIdEncrypted),
      clientSecretConfigurado: Boolean(config?.clientSecretEncrypted),
      certificadoConfigurado: Boolean(config?.certificadoR2Key),
      certificadoPasswordConfigurado: Boolean(
        config?.certificadoPasswordEncrypted,
      ),
      certificado: config?.certificadoR2Key
        ? {
            nombre: config.certificadoNombre,
            mimeType: config.certificadoMimeType,
            sizeBytes: config.certificadoSizeBytes,
            uploadedAt: config.certificadoUploadedAt?.toISOString() ?? null,
          }
        : null,
      updatedAt: config?.updatedAt.toISOString() ?? null,
    };
  }

  private buildReadiness(
    company: CompanyWithSunat,
    endpoints: Set<SunatAmbiente>,
  ) {
    const config = company.sunatConfig;
    const ambiente = config?.ambiente ?? SunatAmbiente.BETA;
    const checks = [
      {
        key: 'ruc',
        label: 'RUC valido',
        ok: Boolean(company.ruc && /^\d{11}$/.test(company.ruc)),
      },
      {
        key: 'legalName',
        label: 'Razon social',
        ok: Boolean(company.razonSocial?.trim()),
      },
      {
        key: 'address',
        label: 'Direccion fiscal',
        ok: Boolean(company.direccion?.trim()),
      },
      {
        key: 'active',
        label: 'Conexion SUNAT activa',
        ok: Boolean(config?.activo),
      },
      {
        key: 'solUser',
        label: 'Usuario SOL',
        ok: Boolean(config?.usuarioSolEncrypted),
      },
      {
        key: 'solPassword',
        label: 'Clave SOL',
        ok: Boolean(config?.claveSolEncrypted),
      },
      {
        key: 'certificate',
        label: 'Certificado digital',
        ok: Boolean(config?.certificadoR2Key),
      },
      {
        key: 'certificatePassword',
        label: 'Contrasena de certificado',
        ok: Boolean(config?.certificadoPasswordEncrypted),
      },
      {
        key: 'endpoint',
        label: `Endpoint ${ambiente} activo`,
        ok: endpoints.has(ambiente),
      },
    ];

    return {
      ready: checks.every((check) => check.ok),
      checks,
      missing: checks.filter((check) => !check.ok).map((check) => check.key),
    };
  }

  private parseCompanyId(id: string) {
    try {
      const value = BigInt(id);
      if (value <= 0n) throw new Error();
      return value;
    } catch {
      throw new BadRequestException('Identificador de empresa invalido');
    }
  }

  private companySelect() {
    return {
      id: true,
      nombreComercial: true,
      razonSocial: true,
      ruc: true,
      dni: true,
      email: true,
      direccion: true,
      estado: true,
      planCodigo: true,
      sunatConfig: {
        select: {
          ambiente: true,
          usuarioSolEncrypted: true,
          claveSolEncrypted: true,
          clientIdEncrypted: true,
          clientSecretEncrypted: true,
          certificadoPasswordEncrypted: true,
          certificadoR2Key: true,
          certificadoNombre: true,
          certificadoMimeType: true,
          certificadoSizeBytes: true,
          certificadoUploadedAt: true,
          igvPorcentaje: true,
          activo: true,
          updatedAt: true,
        },
      },
    } satisfies Prisma.EmpresaSelect;
  }
}
