import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConsultaDocumentoTipo,
  EmpresaUsuarioEstado,
  PlanCodigo,
  Prisma,
  ProductoTipo,
  SucursalTipo,
  UsuarioEstado,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { UpdatePlanLimitsDto } from './dto/update-plan-limits.dto';
import { UpdatePlanPricingDto } from './dto/update-plan-pricing.dto';
import { UpdateOveragePricingDto } from './dto/update-overage-pricing.dto';
import { planCatalog, planList, type PlanLimits } from './plan-catalog';

export type PlanStatus = 'trial' | 'active' | 'expired';
export type PlanResource = keyof PlanLimits;
export type DocumentAllowance = {
  isOverage: boolean;
  unitPrice: Prisma.Decimal | null;
  used: number;
  limit: number;
};
type PrismaClient = PrismaService | Prisma.TransactionClient;
type CompanyPlan = {
  planCodigo: PlanCodigo;
  planInicioAt: Date;
  planFinAt: Date | null;
};
type PricingClient = PrismaService | Prisma.TransactionClient;
type PlanPricing = {
  precioMensual: Prisma.Decimal;
  descuentoMensualPorcentaje: Prisma.Decimal;
  descuentoAnualPorcentaje: Prisma.Decimal;
  updatedAt: Date;
};
type PlanLimitRecord = {
  usuarios: bigint;
  sucursales: bigint;
  almacenes: bigint | null;
  productos: bigint;
  variantes: bigint;
  comprobantes: bigint;
  consultasDocumento: bigint;
  almacenamientoBytes: bigint;
  updatedAt: Date;
};
type AdditionalPlanLimits = Omit<PlanLimits, 'warehouses'> & {
  warehouses: number;
};

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async getCatalog() {
    const [pricing, limits] = await Promise.all([
      this.prisma.tarifaPlan.findMany(),
      this.prisma.limitePlan.findMany(),
    ]);
    const pricingByPlan = new Map(
      pricing.map((item) => [item.planCodigo, item]),
    );
    const limitsByPlan = new Map(limits.map((item) => [item.planCodigo, item]));

    return planList.map((plan) =>
      this.mapCommercialDefinition(
        plan.code,
        this.requirePricing(pricingByPlan.get(plan.code), plan.code),
        this.requireLimits(limitsByPlan.get(plan.code), plan.code),
      ),
    );
  }

  async getAdminPricingCatalog() {
    const [pricing, limits] = await Promise.all([
      this.prisma.tarifaPlan.findMany({
        include: {
          actualizadoPor: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.limitePlan.findMany({
        include: {
          actualizadoPor: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
            },
          },
        },
      }),
    ]);
    const pricingByPlan = new Map(
      pricing.map((item) => [item.planCodigo, item]),
    );
    const limitsByPlan = new Map(limits.map((item) => [item.planCodigo, item]));

    return planList.map((plan) => {
      const item = this.requirePricing(pricingByPlan.get(plan.code), plan.code);
      const limitItem = this.requireLimits(
        limitsByPlan.get(plan.code),
        plan.code,
      );

      return {
        ...this.mapCommercialDefinition(plan.code, item, limitItem),
        updatedBy: item.actualizadoPor
          ? {
              id: item.actualizadoPor.id.toString(),
              name: [item.actualizadoPor.nombre, item.actualizadoPor.apellido]
                .filter(Boolean)
                .join(' '),
              email: item.actualizadoPor.email,
            }
          : null,
        limitsUpdatedAt: limitItem.updatedAt.toISOString(),
        limitsUpdatedBy: limitItem.actualizadoPor
          ? {
              id: limitItem.actualizadoPor.id.toString(),
              name: [
                limitItem.actualizadoPor.nombre,
                limitItem.actualizadoPor.apellido,
              ]
                .filter(Boolean)
                .join(' '),
              email: limitItem.actualizadoPor.email,
            }
          : null,
      };
    });
  }

  getDefinition(code: PlanCodigo) {
    return planCatalog[code];
  }

  async getCommercialDefinition(
    code: PlanCodigo,
    tx: PricingClient = this.prisma,
  ) {
    const [pricing, limits] = await Promise.all([
      tx.tarifaPlan.findUnique({ where: { planCodigo: code } }),
      tx.limitePlan.findUnique({ where: { planCodigo: code } }),
    ]);

    return this.mapCommercialDefinition(
      code,
      this.requirePricing(pricing, code),
      this.requireLimits(limits, code),
    );
  }

  async updatePricing(
    actor: JwtPayload,
    code: PlanCodigo,
    dto: UpdatePlanPricingDto,
  ) {
    if (code === PlanCodigo.prueba) {
      throw new BadRequestException('El plan Prueba no tiene tarifa editable');
    }

    const price = new Prisma.Decimal(dto.priceMonthly);
    const monthlyDiscount = new Prisma.Decimal(dto.monthlyDiscountPercent);
    const annualDiscount = new Prisma.Decimal(dto.annualDiscountPercent);
    if (price.lt(1) || price.gt(999_999.99)) {
      throw new BadRequestException('El precio mensual no es valido');
    }
    if (annualDiscount.lt(0) || annualDiscount.gt(50)) {
      throw new BadRequestException(
        'El descuento anual debe estar entre 0 y 50',
      );
    }
    if (monthlyDiscount.lt(0) || monthlyDiscount.gt(50)) {
      throw new BadRequestException(
        'El descuento mensual debe estar entre 0 y 50',
      );
    }

    const actorId = BigInt(actor.sub);
    const expectedUpdatedAt = new Date(dto.expectedUpdatedAt);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "plan_codigo" FROM "tarifa_plan" WHERE "plan_codigo" = CAST(${code} AS "PlanCodigo") FOR UPDATE`;
      const current = await tx.tarifaPlan.findUnique({
        where: { planCodigo: code },
      });

      if (!current) {
        throw new NotFoundException('Tarifa de plan no encontrada');
      }
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException({
          code: 'PLAN_PRICING_CHANGED',
          message: 'La tarifa fue modificada por otro administrador',
        });
      }

      const result = await tx.tarifaPlan.update({
        where: { planCodigo: code },
        data: {
          precioMensual: price,
          descuentoMensualPorcentaje: monthlyDiscount,
          descuentoAnualPorcentaje: annualDiscount,
          actualizadoPorId: actorId,
        },
        include: {
          actualizadoPor: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              email: true,
            },
          },
        },
      });

      await tx.platformAuditLog.create({
        data: {
          usuarioId: actorId,
          category: 'plan',
          action: 'plan_pricing_updated',
          source: 'admin',
          description: `Tarifa del plan ${this.getDefinition(code).name} actualizada`,
          metadata: {
            planCode: code,
            previousMonthlyPrice: current.precioMensual.toFixed(2),
            monthlyPrice: price.toFixed(2),
            previousMonthlyDiscount:
              current.descuentoMensualPorcentaje.toFixed(2),
            monthlyDiscount: monthlyDiscount.toFixed(2),
            previousAnnualDiscount: current.descuentoAnualPorcentaje.toFixed(2),
            annualDiscount: annualDiscount.toFixed(2),
          },
        },
      });

      return result;
    });

    const limits = this.requireLimits(
      await this.prisma.limitePlan.findUnique({
        where: { planCodigo: code },
        include: {
          actualizadoPor: {
            select: { id: true, nombre: true, apellido: true, email: true },
          },
        },
      }),
      code,
    );
    return {
      ...this.mapCommercialDefinition(code, updated, limits),
      updatedBy: updated.actualizadoPor
        ? {
            id: updated.actualizadoPor.id.toString(),
            name: [
              updated.actualizadoPor.nombre,
              updated.actualizadoPor.apellido,
            ]
              .filter(Boolean)
              .join(' '),
            email: updated.actualizadoPor.email,
          }
        : null,
      limitsUpdatedAt: limits.updatedAt.toISOString(),
      limitsUpdatedBy: limits.actualizadoPor
        ? {
            id: limits.actualizadoPor.id.toString(),
            name: [limits.actualizadoPor.nombre, limits.actualizadoPor.apellido]
              .filter(Boolean)
              .join(' '),
            email: limits.actualizadoPor.email,
          }
        : null,
    };
  }

  async updateLimits(
    actor: JwtPayload,
    code: PlanCodigo,
    dto: UpdatePlanLimitsDto,
  ) {
    const actorId = BigInt(actor.sub);
    const expectedUpdatedAt = new Date(dto.expectedUpdatedAt);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "plan_codigo" FROM "limite_plan" WHERE "plan_codigo" = CAST(${code} AS "PlanCodigo") FOR UPDATE`;
      const current = await tx.limitePlan.findUnique({
        where: { planCodigo: code },
      });
      if (!current)
        throw new NotFoundException('Limites de plan no encontrados');
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException({
          code: 'PLAN_LIMITS_CHANGED',
          message: 'Los limites fueron modificados por otro administrador',
        });
      }

      const result = await tx.limitePlan.update({
        where: { planCodigo: code },
        data: {
          usuarios: BigInt(dto.users),
          sucursales: BigInt(dto.branches),
          almacenes: dto.warehouses === null ? null : BigInt(dto.warehouses),
          productos: BigInt(dto.products),
          variantes: BigInt(dto.variants),
          comprobantes: BigInt(dto.documents),
          consultasDocumento: BigInt(dto.documentQueries),
          almacenamientoBytes: BigInt(dto.storageBytes),
          actualizadoPorId: actorId,
        },
        include: {
          actualizadoPor: {
            select: { id: true, nombre: true, apellido: true, email: true },
          },
        },
      });

      await tx.platformAuditLog.create({
        data: {
          usuarioId: actorId,
          category: 'plan',
          action: 'plan_limits_updated',
          source: 'admin',
          description: `Limites del plan ${this.getDefinition(code).name} actualizados`,
          metadata: {
            planCode: code,
            previous: this.mapPlanLimits(current),
            current: this.mapPlanLimits(result),
          },
        },
      });
      return result;
    });

    const pricing = await this.prisma.tarifaPlan.findUnique({
      where: { planCodigo: code },
      include: {
        actualizadoPor: {
          select: { id: true, nombre: true, apellido: true, email: true },
        },
      },
    });
    return {
      ...this.mapCommercialDefinition(
        code,
        this.requirePricing(pricing, code),
        updated,
      ),
      updatedBy: pricing?.actualizadoPor
        ? {
            id: pricing.actualizadoPor.id.toString(),
            name: [
              pricing.actualizadoPor.nombre,
              pricing.actualizadoPor.apellido,
            ]
              .filter(Boolean)
              .join(' '),
            email: pricing.actualizadoPor.email,
          }
        : null,
      limitsUpdatedAt: updated.updatedAt.toISOString(),
      limitsUpdatedBy: updated.actualizadoPor
        ? {
            id: updated.actualizadoPor.id.toString(),
            name: [
              updated.actualizadoPor.nombre,
              updated.actualizadoPor.apellido,
            ]
              .filter(Boolean)
              .join(' '),
            email: updated.actualizadoPor.email,
          }
        : null,
    };
  }

  async getOveragePricing() {
    const pricing = await this.prisma.tarifaComprobanteExcedente.findUnique({
      where: { id: 1 },
      include: {
        actualizadoPor: {
          select: { id: true, nombre: true, apellido: true, email: true },
        },
      },
    });
    if (!pricing)
      throw new NotFoundException('Tarifa de excedente no encontrada');
    return this.mapOveragePricing(pricing);
  }

  async updateOveragePricing(actor: JwtPayload, dto: UpdateOveragePricingDto) {
    const price = new Prisma.Decimal(dto.unitPrice);
    if (price.lt(0) || price.gt(999_999.99)) {
      throw new BadRequestException('El precio por comprobante no es valido');
    }
    const actorId = BigInt(actor.sub);
    const expected = new Date(dto.expectedUpdatedAt);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "tarifa_comprobante_excedente" WHERE "id" = 1 FOR UPDATE`;
      const current = await tx.tarifaComprobanteExcedente.findUnique({
        where: { id: 1 },
      });
      if (!current)
        throw new NotFoundException('Tarifa de excedente no encontrada');
      if (current.updatedAt.getTime() !== expected.getTime()) {
        throw new ConflictException({
          code: 'OVERAGE_PRICING_CHANGED',
          message: 'La tarifa fue modificada por otro administrador',
        });
      }
      const result = await tx.tarifaComprobanteExcedente.update({
        where: { id: 1 },
        data: { precioUnitario: price, actualizadoPorId: actorId },
        include: {
          actualizadoPor: {
            select: { id: true, nombre: true, apellido: true, email: true },
          },
        },
      });
      await tx.platformAuditLog.create({
        data: {
          usuarioId: actorId,
          category: 'plan',
          action: 'overage_pricing_updated',
          source: 'admin',
          description: 'Tarifa global por comprobante adicional actualizada',
          metadata: {
            previousUnitPrice: current.precioUnitario.toFixed(2),
            unitPrice: price.toFixed(2),
          },
        },
      });
      return result;
    });
    return this.mapOveragePricing(updated);
  }

  private mapOveragePricing(pricing: {
    precioUnitario: Prisma.Decimal;
    updatedAt: Date;
    actualizadoPor: {
      id: bigint;
      nombre: string;
      apellido: string | null;
      email: string;
    } | null;
  }) {
    return {
      unitPrice: pricing.precioUnitario.toFixed(2),
      currency: 'PEN' as const,
      includesIgv: true as const,
      updatedAt: pricing.updatedAt.toISOString(),
      updatedBy: pricing.actualizadoPor
        ? {
            id: pricing.actualizadoPor.id.toString(),
            name: [
              pricing.actualizadoPor.nombre,
              pricing.actualizadoPor.apellido,
            ]
              .filter(Boolean)
              .join(' '),
            email: pricing.actualizadoPor.email,
          }
        : null,
    };
  }

  getStatus(company: CompanyPlan, now = new Date()): PlanStatus {
    if (
      (company.planCodigo === PlanCodigo.prueba && !company.planFinAt) ||
      (company.planFinAt && company.planFinAt.getTime() <= now.getTime())
    ) {
      return 'expired';
    }

    return company.planCodigo === PlanCodigo.prueba ? 'trial' : 'active';
  }

  getEffectiveModuleKeys(
    company: CompanyPlan,
    roles: string[],
    assignedModuleKeys: string[],
    now = new Date(),
  ) {
    if (this.getStatus(company, now) === 'expired') {
      return [];
    }

    const available = new Set<string>(
      this.getDefinition(company.planCodigo).moduleKeys,
    );

    return roles.includes('OWNER')
      ? Array.from(available)
      : assignedModuleKeys.filter((moduleKey) => available.has(moduleKey));
  }

  async getCurrent(
    empresaId: bigint,
    effectiveModuleKeys: string[] = [],
    now = new Date(),
  ) {
    const company = await this.findCompany(this.prisma, empresaId);
    const definition = await this.getCommercialDefinition(company.planCodigo);
    const documentRange = this.getDocumentRange(company, now);
    const [
      users,
      branches,
      warehouses,
      products,
      variants,
      documents,
      documentQueries,
      storage,
      extras,
      overage,
      paidSubscriptions,
    ] = await this.prisma.$transaction([
      this.prisma.empresaUsuario.count({
        where: {
          empresaId,
          estado: EmpresaUsuarioEstado.activo,
          usuario: { estado: UsuarioEstado.activo },
        },
      }),
      this.prisma.sucursal.count({
        where: { empresaId, tipo: SucursalTipo.tienda },
      }),
      this.prisma.sucursal.count({
        where: { empresaId, tipo: SucursalTipo.almacen },
      }),
      this.prisma.producto.count({
        where: { empresaId, deletedAt: null },
      }),
      this.prisma.productoVariante.count({
        where: {
          empresaId,
          deletedAt: null,
          producto: { tipo: ProductoTipo.variantes },
        },
      }),
      this.prisma.venta.count({
        where: {
          empresaId,
          createdAt: {
            gte: documentRange.start,
            ...(documentRange.end ? { lt: documentRange.end } : {}),
          },
        },
      }),
      this.prisma.consultaDocumento.count({
        where: {
          empresaId,
          createdAt: {
            gte: documentRange.start,
            ...(documentRange.end ? { lt: documentRange.end } : {}),
          },
        },
      }),
      this.prisma.productoColorImagen.aggregate({
        where: { empresaId },
        _sum: { sizeBytes: true },
      }),
      this.prisma.empresaLimiteAdicional.findUnique({
        where: { empresaId },
      }),
      this.prisma.venta.aggregate({
        where: {
          empresaId,
          esExcedentePlan: true,
          createdAt: {
            gte: documentRange.start,
            ...(documentRange.end ? { lt: documentRange.end } : {}),
          },
        },
        _count: { _all: true },
        _sum: { precioExcedentePlan: true },
      }),
      this.prisma.pagoSuscripcion.count({
        where: { empresaId, estado: 'pagado' },
      }),
    ]);
    const usage: PlanLimits = {
      users,
      branches,
      warehouses,
      products,
      variants,
      documents,
      documentQueries,
      storageBytes: storage._sum.sizeBytes ?? 0,
    };

    const additionalLimits = this.mapAdditionalLimits(extras);
    const effectiveLimits = this.buildEffectiveLimits(
      definition.limits,
      additionalLimits,
    );

    return {
      plan: definition,
      status: this.getStatus(company, now),
      startsAt: company.planInicioAt,
      endsAt: company.planFinAt,
      daysRemaining: company.planFinAt
        ? Math.max(
            0,
            Math.ceil(
              (company.planFinAt.getTime() - now.getTime()) /
                (24 * 60 * 60 * 1000),
            ),
          )
        : null,
      usage,
      baseLimits: definition.limits,
      additionalLimits,
      effectiveLimits,
      remaining: this.buildRemaining(usage, effectiveLimits),
      documentOverage: {
        count: overage._count._all,
        estimatedAmount: (
          overage._sum.precioExcedentePlan ?? new Prisma.Decimal(0)
        ).toFixed(2),
        currency: 'PEN' as const,
      },
      monthlyDiscountEligible: paidSubscriptions === 0,
      effectiveModuleKeys,
    };
  }

  async getAvailableModuleKeys(empresaId: bigint) {
    const company = await this.findCompany(this.prisma, empresaId);

    if (this.getStatus(company) === 'expired') {
      return [];
    }

    return [...this.getDefinition(company.planCodigo).moduleKeys];
  }

  async assertModulesIncluded(empresaId: bigint, moduleKeys: string[]) {
    const company = await this.findCompany(this.prisma, empresaId);
    this.assertPlanActive(company);
    const available = new Set<string>(
      this.getDefinition(company.planCodigo).moduleKeys,
    );
    const unavailable = moduleKeys.find(
      (moduleKey) => !available.has(moduleKey),
    );

    if (unavailable) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_INCLUDED',
        message: `El modulo ${unavailable} no esta incluido en el plan`,
      });
    }

    return available;
  }

  async assertResourceLimits(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
    checks: Partial<Record<PlanResource, number>>,
    now = new Date(),
  ) {
    await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
    const company = await this.findCompany(tx, empresaId);
    this.assertPlanActive(company, now);
    const limits = await this.getEffectiveLimits(tx, empresaId, company);

    for (const [resource, increment] of Object.entries(checks) as [
      PlanResource,
      number,
    ][]) {
      if (increment <= 0) {
        continue;
      }

      const used = await this.getResourceUsage(
        tx,
        empresaId,
        company,
        resource,
        now,
      );
      const limit = limits[resource];

      if (limit === null) {
        continue;
      }

      if (used + increment > limit) {
        throw new ConflictException({
          code: 'PLAN_LIMIT_REACHED',
          message: `Alcanzaste el limite de ${this.getResourceLabel(resource)} de tu plan`,
          resource,
          used,
          limit,
        });
      }
    }
  }

  async assessDocumentAllowance(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
    increment = 1,
    now = new Date(),
  ): Promise<DocumentAllowance> {
    await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
    const company = await this.findCompany(tx, empresaId);
    this.assertPlanActive(company, now);
    const limits = await this.getEffectiveLimits(tx, empresaId, company);
    const used = await this.getResourceUsage(
      tx,
      empresaId,
      company,
      'documents',
      now,
    );
    const isOverage = used + increment > limits.documents;

    if (!isOverage) {
      return {
        isOverage: false,
        unitPrice: null,
        used,
        limit: limits.documents,
      };
    }
    if (company.planCodigo === PlanCodigo.prueba) {
      throw new ConflictException({
        code: 'PLAN_LIMIT_REACHED',
        message: 'Alcanzaste el limite de comprobantes de tu plan',
        resource: 'documents',
        used,
        limit: limits.documents,
      });
    }

    const pricing = await tx.tarifaComprobanteExcedente.findUnique({
      where: { id: 1 },
    });
    if (!pricing) {
      throw new ConflictException({
        code: 'OVERAGE_PRICING_NOT_CONFIGURED',
        message: 'La tarifa de comprobantes adicionales no esta configurada',
      });
    }

    return {
      isOverage: true,
      unitPrice: pricing.precioUnitario,
      used,
      limit: limits.documents,
    };
  }

  async getEffectiveLimits(
    tx: PrismaClient,
    empresaId: bigint,
    company?: CompanyPlan,
  ) {
    const currentCompany = company ?? (await this.findCompany(tx, empresaId));
    const [baseLimits, extras] = await Promise.all([
      this.getBaseLimits(tx, currentCompany.planCodigo),
      tx.empresaLimiteAdicional.findUnique({ where: { empresaId } }),
    ]);
    return this.buildEffectiveLimits(
      baseLimits,
      this.mapAdditionalLimits(extras),
    );
  }

  recordDocumentQuery(
    empresaId: bigint,
    usuarioId: bigint,
    tipo: ConsultaDocumentoTipo,
    now = new Date(),
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
        const company = await this.findCompany(tx, empresaId);
        this.assertPlanActive(company, now);
        const limits = await this.getEffectiveLimits(tx, empresaId, company);
        const used = await this.getResourceUsage(
          tx,
          empresaId,
          company,
          'documentQueries',
          now,
        );

        if (used >= limits.documentQueries) {
          throw new ConflictException({
            code: 'PLAN_LIMIT_REACHED',
            message: 'Alcanzaste el limite de consultas DNI/RUC de tu plan',
            resource: 'documentQueries',
            used,
            limit: limits.documentQueries,
          });
        }

        await tx.consultaDocumento.create({
          data: { empresaId, usuarioId, tipo },
        });

        return {
          used: used + 1,
          limit: limits.documentQueries,
          remaining: Math.max(0, limits.documentQueries - used - 1),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async getBaseLimits(tx: PricingClient, code: PlanCodigo) {
    return this.mapPlanLimits(await this.getBaseLimitsRecord(tx, code));
  }

  mapAdditionalLimits(
    extras:
      | {
          usuarios: bigint;
          sucursales: bigint;
          almacenes: bigint;
          productos: bigint;
          variantes: bigint;
          comprobantes: bigint;
          consultasDocumento: bigint;
          almacenamientoBytes: bigint;
        }
      | null
      | undefined,
  ): AdditionalPlanLimits {
    return {
      users: Number(extras?.usuarios ?? 0),
      branches: Number(extras?.sucursales ?? 0),
      warehouses: Number(extras?.almacenes ?? 0),
      products: Number(extras?.productos ?? 0),
      variants: Number(extras?.variantes ?? 0),
      documents: Number(extras?.comprobantes ?? 0),
      documentQueries: Number(extras?.consultasDocumento ?? 0),
      storageBytes: Number(extras?.almacenamientoBytes ?? 0),
    };
  }

  buildEffectiveLimits(
    base: PlanLimits,
    extras: AdditionalPlanLimits,
  ): PlanLimits {
    return {
      users: base.users + extras.users,
      branches: base.branches + extras.branches,
      warehouses:
        base.warehouses === null
          ? null
          : base.warehouses + (extras.warehouses ?? 0),
      products: base.products + extras.products,
      variants: base.variants + extras.variants,
      documents: base.documents + extras.documents,
      documentQueries: base.documentQueries + extras.documentQueries,
      storageBytes: base.storageBytes + extras.storageBytes,
    };
  }

  private async getResourceUsage(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
    company: CompanyPlan,
    resource: PlanResource,
    now: Date,
  ) {
    switch (resource) {
      case 'users':
        return tx.empresaUsuario.count({
          where: {
            empresaId,
            estado: EmpresaUsuarioEstado.activo,
            usuario: { estado: UsuarioEstado.activo },
          },
        });
      case 'branches':
        return tx.sucursal.count({
          where: { empresaId, tipo: SucursalTipo.tienda },
        });
      case 'warehouses':
        return tx.sucursal.count({
          where: { empresaId, tipo: SucursalTipo.almacen },
        });
      case 'products':
        return tx.producto.count({ where: { empresaId, deletedAt: null } });
      case 'variants':
        return tx.productoVariante.count({
          where: {
            empresaId,
            deletedAt: null,
            producto: { tipo: ProductoTipo.variantes },
          },
        });
      case 'documents': {
        const range = this.getDocumentRange(company, now);
        return tx.venta.count({
          where: {
            empresaId,
            createdAt: {
              gte: range.start,
              ...(range.end ? { lt: range.end } : {}),
            },
          },
        });
      }
      case 'documentQueries': {
        const range = this.getDocumentRange(company, now);
        return tx.consultaDocumento.count({
          where: {
            empresaId,
            createdAt: {
              gte: range.start,
              ...(range.end ? { lt: range.end } : {}),
            },
          },
        });
      }
      case 'storageBytes': {
        const storage = await tx.productoColorImagen.aggregate({
          where: { empresaId },
          _sum: { sizeBytes: true },
        });
        return storage._sum.sizeBytes ?? 0;
      }
    }
  }

  getDocumentRange(company: CompanyPlan, now: Date) {
    if (company.planCodigo === PlanCodigo.prueba) {
      return { start: company.planInicioAt, end: company.planFinAt };
    }

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);

    return {
      start: new Date(Date.UTC(year, month - 1, 1, 5)),
      end: new Date(Date.UTC(year, month, 1, 5)),
    };
  }

  private async findCompany(tx: PrismaClient, empresaId: bigint) {
    const company = await tx.empresa.findUnique({
      where: { id: empresaId },
      select: {
        planCodigo: true,
        planInicioAt: true,
        planFinAt: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }

    return company;
  }

  private assertPlanActive(company: CompanyPlan, now = new Date()) {
    if (this.getStatus(company, now) === 'expired') {
      throw new ForbiddenException({
        code: 'PLAN_EXPIRED',
        message: 'La suscripcion esta vencida',
      });
    }
  }

  private buildRemaining(usage: PlanLimits, limits: PlanLimits): PlanLimits {
    return Object.fromEntries(
      (Object.keys(limits) as PlanResource[]).map((resource) => [
        resource,
        limits[resource] === null
          ? null
          : Math.max(0, limits[resource] - (usage[resource] ?? 0)),
      ]),
    ) as PlanLimits;
  }

  private getResourceLabel(resource: PlanResource) {
    return {
      users: 'usuarios',
      branches: 'sucursales',
      warehouses: 'almacenes',
      products: 'productos',
      variants: 'variantes',
      documents: 'comprobantes',
      documentQueries: 'consultas DNI/RUC',
      storageBytes: 'almacenamiento de imagenes',
    }[resource];
  }

  private mapCommercialDefinition(
    code: PlanCodigo,
    pricing: PlanPricing,
    limits: PlanLimitRecord,
  ) {
    const annual = calculatePlanSalePricing(
      pricing.precioMensual,
      pricing.descuentoMensualPorcentaje,
      pricing.descuentoAnualPorcentaje,
      12,
    );
    const monthly = calculatePlanSalePricing(
      pricing.precioMensual,
      pricing.descuentoMensualPorcentaje,
      pricing.descuentoAnualPorcentaje,
      1,
    );

    const definition = this.getDefinition(code);
    const mappedLimits = this.mapPlanLimits(limits);
    return {
      ...definition,
      limits: mappedLimits,
      highlights: this.buildHighlights(
        code,
        definition.trialDays,
        mappedLimits,
      ),
      priceMonthly: pricing.precioMensual.toFixed(2),
      monthlyDiscountPercent: pricing.descuentoMensualPorcentaje.toFixed(2),
      monthlyOfferPrice: monthly.total.toFixed(2),
      annualDiscountPercent: pricing.descuentoAnualPorcentaje.toFixed(2),
      annualPrice: annual.total.toFixed(2),
      pricingUpdatedAt: pricing.updatedAt.toISOString(),
      currency: 'PEN' as const,
      includesIgv: true as const,
    };
  }

  private mapPlanLimits(limits: PlanLimitRecord): PlanLimits {
    return {
      users: Number(limits.usuarios),
      branches: Number(limits.sucursales),
      warehouses: limits.almacenes === null ? null : Number(limits.almacenes),
      products: Number(limits.productos),
      variants: Number(limits.variantes),
      documents: Number(limits.comprobantes),
      documentQueries: Number(limits.consultasDocumento),
      storageBytes: Number(limits.almacenamientoBytes),
    };
  }

  private buildHighlights(
    code: PlanCodigo,
    trialDays: number | null,
    limits: PlanLimits,
  ) {
    if (code === PlanCodigo.prueba) {
      return [
        `${trialDays ?? 7} dias de acceso`,
        `${limits.branches} sucursal${limits.branches === 1 ? '' : 'es'}`,
        `${limits.products.toLocaleString('es-PE')} productos`,
        'Todos los modulos',
      ];
    }
    if (code === PlanCodigo.emprendedor) {
      return [
        `${limits.users.toLocaleString('es-PE')} usuarios`,
        `${limits.products.toLocaleString('es-PE')} productos`,
        `${limits.documents.toLocaleString('es-PE')} comprobantes al mes`,
        'Reportes excepto usuarios',
      ];
    }
    if (code === PlanCodigo.basico) {
      return [
        `${limits.users.toLocaleString('es-PE')} usuario`,
        `${limits.products.toLocaleString('es-PE')} productos`,
        `${limits.documents.toLocaleString('es-PE')} comprobantes al mes`,
        'Reportes de ventas y productos',
      ];
    }
    if (code === PlanCodigo.crecimiento) {
      return [
        `${limits.branches.toLocaleString('es-PE')} sucursales`,
        `${limits.users.toLocaleString('es-PE')} usuarios`,
        'Todos los modulos',
      ];
    }
    return [
      `${limits.branches.toLocaleString('es-PE')} sucursales`,
      `${limits.users.toLocaleString('es-PE')} usuarios`,
      'Todos los modulos',
    ];
  }

  private async getBaseLimitsRecord(tx: PricingClient, code: PlanCodigo) {
    const limits = await tx.limitePlan.findUnique({
      where: { planCodigo: code },
    });
    return this.requireLimits(limits, code);
  }

  private requirePricing<T extends PlanPricing>(
    pricing: T | undefined | null,
    code: PlanCodigo,
  ): T {
    if (!pricing) {
      throw new NotFoundException(
        `Tarifa del plan ${this.getDefinition(code).name} no encontrada`,
      );
    }

    return pricing;
  }

  private requireLimits<T extends PlanLimitRecord>(
    limits: T | undefined | null,
    code: PlanCodigo,
  ): T {
    if (!limits) {
      throw new NotFoundException(
        `Limites del plan ${this.getDefinition(code).name} no encontrados`,
      );
    }
    return limits;
  }
}

export function calculatePlanSalePricing(
  monthlyPrice: Prisma.Decimal,
  monthlyDiscountPercent: Prisma.Decimal,
  annualDiscountPercent: Prisma.Decimal,
  months: number,
) {
  const listAmount = monthlyPrice.mul(months).toDecimalPlaces(2);
  const discountPercent =
    months === 1
      ? monthlyDiscountPercent
      : months === 12
        ? annualDiscountPercent
        : new Prisma.Decimal(0);
  const discountAmount = listAmount
    .mul(discountPercent)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  return {
    listAmount,
    discountPercent,
    discountAmount,
    total: listAmount.minus(discountAmount).toDecimalPlaces(2),
  };
}
