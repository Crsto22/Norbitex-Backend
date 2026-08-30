import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LiquidacionExcedenteEstado,
  NotificacionCategoria,
  NotificacionNivel,
  PagoSuscripcionMetodo,
  PlanCodigo,
  Prisma,
  SucursalTipo,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PlansService } from '../plans/plans.service';
import {
  CloseOverageDto,
  FindOveragesQueryDto,
  PayOverageDto,
  UpdateCompanyAttendanceCapacityDto,
  UpdateCompanyAttendanceAddonDto,
  UpdateCompanyExtraLimitsDto,
} from './dto/platform-overages.dto';
import { PlatformBillingService } from '../platform-billing/platform-billing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UpdateCompanyModulesDto } from './dto/update-company-modules.dto';
import { userModuleKeys, userModuleKeySet } from '../users/user-modules';

const liquidationInclude = {
  empresa: {
    select: { id: true, nombreComercial: true, ruc: true, dni: true },
  },
  cerradaPor: {
    select: { id: true, nombre: true, apellido: true, email: true },
  },
  pagadaPor: {
    select: { id: true, nombre: true, apellido: true, email: true },
  },
  comprobante: {
    select: { id: true, tipo: true, serie: true, numero: true, estado: true },
  },
} satisfies Prisma.LiquidacionExcedenteInclude;

type OverageAggregate = {
  empresaId: bigint;
  periodo: string;
  cantidad: bigint;
  montoTotal: Prisma.Decimal;
  empresaNombre: string;
  ruc: string | null;
  dni: string | null;
  liquidationId?: bigint | null;
};
type OverageStats = {
  total: bigint;
  pendingAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
};
type Liquidation = Prisma.LiquidacionExcedenteGetPayload<{
  include: typeof liquidationInclude;
}>;
type CompanyWithLimits = {
  id: bigint;
  nombreComercial: string;
  planCodigo: PlanCodigo;
  planInicioAt: Date;
  planFinAt: Date | null;
  asistenciasActiva: boolean;
  asistenciasTrabajadoresLimite: bigint;
  asistenciasPuntosQrLimite: bigint;
  asistenciasInicioAt: Date | null;
  asistenciasFinAt: Date | null;
  limitesAdicionales: {
    usuarios: bigint;
    sucursales: bigint;
    almacenes: bigint;
    productos: bigint;
    variantes: bigint;
    comprobantes: bigint;
    consultasDocumento: bigint;
    almacenamientoBytes: bigint;
    trabajadoresAsistencia: bigint;
    puntosQrAsistencia: bigint;
    updatedAt: Date;
  } | null;
};

@Injectable()
export class PlatformOveragesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly billingService: PlatformBillingService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getCompanyLimits(id: string) {
    const empresaId = this.parseId(id, 'empresa');
    const company = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        nombreComercial: true,
        planCodigo: true,
        planInicioAt: true,
        planFinAt: true,
        asistenciasActiva: true,
        asistenciasTrabajadoresLimite: true,
        asistenciasPuntosQrLimite: true,
        asistenciasInicioAt: true,
        asistenciasFinAt: true,
        limitesAdicionales: true,
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return this.mapCompanyLimits(company);
  }

  async updateCompanyLimits(
    actor: JwtPayload,
    id: string,
    dto: UpdateCompanyExtraLimitsDto,
  ) {
    const empresaId = this.parseId(id, 'empresa');
    const actorId = this.parseId(actor.sub, 'administrador');
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
      const company = await tx.empresa.findUnique({
        where: { id: empresaId },
        select: {
          id: true,
          nombreComercial: true,
          planCodigo: true,
          planInicioAt: true,
          planFinAt: true,
          asistenciasActiva: true,
          asistenciasTrabajadoresLimite: true,
          asistenciasPuntosQrLimite: true,
          asistenciasInicioAt: true,
          asistenciasFinAt: true,
          limitesAdicionales: true,
        },
      });
      if (!company) throw new NotFoundException('Empresa no encontrada');
      const data = {
        usuarios: BigInt(dto.users),
        sucursales: BigInt(dto.branches),
        almacenes: BigInt(dto.warehouses),
        productos: BigInt(dto.products),
        variantes: BigInt(dto.variants),
        comprobantes: BigInt(dto.documents),
        consultasDocumento: BigInt(dto.documentQueries),
        almacenamientoBytes: BigInt(dto.storageBytes),
        trabajadoresAsistencia: BigInt(dto.attendanceEmployees),
        puntosQrAsistencia: BigInt(dto.attendanceQrPoints),
        actualizadoPorId: actorId,
      };
      const updated = await tx.empresaLimiteAdicional.upsert({
        where: { empresaId },
        create: { empresaId, ...data },
        update: data,
      });
      await tx.platformAuditLog.create({
        data: {
          empresaId,
          usuarioId: actorId,
          category: 'plan',
          action: 'company_limits_updated',
          source: 'admin',
          description: `Limites adicionales actualizados para ${company.nombreComercial}`,
          metadata: {
            previous: this.plansService.mapAdditionalLimits(
              company.limitesAdicionales,
            ),
            current: this.plansService.mapAdditionalLimits(updated),
          },
        },
      });
      const previous = this.plansService.mapAdditionalLimits(
        company.limitesAdicionales,
      );
      const current = this.plansService.mapAdditionalLimits(updated);
      return {
        result: await this.mapCompanyLimits({
          ...company,
          limitesAdicionales: updated,
        }),
        increases: describeLimitIncreases(previous, current),
        updatedAt: updated.updatedAt,
      };
    });

    if (outcome.increases.length) {
      const owners = await this.notificationsService.getOwnerIds(empresaId);
      await this.notificationsService.createAutomatic({
        eventKey: `company-bonus:${empresaId.toString()}:${outcome.updatedAt.toISOString()}`,
        category: NotificacionCategoria.limite,
        level: NotificacionNivel.exito,
        title: 'Recibiste una bonificación',
        message: `Tu empresa recibió una bonificación adicional: ${outcome.increases.join(', ')}. Gracias por seguir usando Norbitex.`,
        link: '/configuracion/plan',
        companyId: empresaId,
        recipientIds: owners,
      });
    }

    return outcome.result;
  }

  async getCompanyAttendanceAddon(id: string) {
    const empresaId = this.parseId(id, 'empresa');
    const company = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        nombreComercial: true,
        planCodigo: true,
        planInicioAt: true,
        planFinAt: true,
        asistenciasActiva: true,
        asistenciasTrabajadoresLimite: true,
        asistenciasPuntosQrLimite: true,
        asistenciasInicioAt: true,
        asistenciasFinAt: true,
        limitesAdicionales: true,
        _count: {
          select: {
            empleados: { where: { estado: 'activo' } },
            puntosQrAsistencia: { where: { estado: 'activo' } },
            sucursales: { where: { tipo: SucursalTipo.tienda } },
          },
        },
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return this.mapCompanyAttendanceAddon(company);
  }

  async updateCompanyAttendanceAddon(
    actor: JwtPayload,
    id: string,
    dto: UpdateCompanyAttendanceAddonDto,
  ) {
    const empresaId = this.parseId(id, 'empresa');
    const actorId = this.parseId(actor.sub, 'administrador');
    const startsAt = dto.active ? new Date(dto.startsAt ?? new Date()) : null;
    const endsAt = dto.active && dto.endsAt ? new Date(dto.endsAt) : null;
    if (dto.active && !endsAt) {
      throw new BadRequestException(
        'La fecha de fin de Asistencias es obligatoria',
      );
    }
    if (startsAt && endsAt && endsAt < startsAt) {
      throw new BadRequestException(
        'La fecha de fin debe ser posterior al inicio',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
      const current = await tx.empresa.findUnique({
        where: { id: empresaId },
        select: {
          id: true,
          nombreComercial: true,
          planCodigo: true,
          planInicioAt: true,
          planFinAt: true,
          asistenciasActiva: true,
          asistenciasTrabajadoresLimite: true,
          asistenciasPuntosQrLimite: true,
          asistenciasInicioAt: true,
          asistenciasFinAt: true,
        },
      });
      if (!current) throw new NotFoundException('Empresa no encontrada');

      const [activeEmployees, activeQrPoints] = await Promise.all([
        tx.empleado.count({ where: { empresaId, estado: 'activo' } }),
        tx.puntoQrAsistencia.count({ where: { empresaId, estado: 'activo' } }),
      ]);
      if (dto.active && activeEmployees > dto.employeesLimit) {
        throw new ConflictException({
          code: 'ATTENDANCE_EMPLOYEE_LIMIT_BELOW_USAGE',
          message:
            'El limite de trabajadores no puede ser menor al consumo actual',
          used: activeEmployees,
          limit: dto.employeesLimit,
        });
      }
      if (dto.active && activeQrPoints > dto.qrPointsLimit) {
        throw new ConflictException({
          code: 'ATTENDANCE_QR_LIMIT_BELOW_USAGE',
          message:
            'El limite de puntos QR no puede ser menor al consumo actual',
          used: activeQrPoints,
          limit: dto.qrPointsLimit,
        });
      }

      const updated = await tx.empresa.update({
        where: { id: empresaId },
        data: {
          asistenciasActiva: dto.active,
          asistenciasTrabajadoresLimite: BigInt(
            dto.active ? dto.employeesLimit : 0,
          ),
          asistenciasPuntosQrLimite: BigInt(dto.active ? dto.qrPointsLimit : 0),
          asistenciasInicioAt: startsAt,
          asistenciasFinAt: endsAt,
        },
        select: {
          id: true,
          nombreComercial: true,
          planCodigo: true,
          planInicioAt: true,
          planFinAt: true,
          asistenciasActiva: true,
          asistenciasTrabajadoresLimite: true,
          asistenciasPuntosQrLimite: true,
          asistenciasInicioAt: true,
          asistenciasFinAt: true,
          limitesAdicionales: true,
          _count: {
            select: {
              empleados: { where: { estado: 'activo' } },
              puntosQrAsistencia: { where: { estado: 'activo' } },
              sucursales: { where: { tipo: SucursalTipo.tienda } },
            },
          },
        },
      });

      await tx.platformAuditLog.create({
        data: {
          empresaId,
          usuarioId: actorId,
          category: 'plan',
          action: 'company_attendance_addon_updated',
          source: 'admin',
          description: `Asistencias actualizadas para ${current.nombreComercial}`,
          metadata: {
            previous: this.plansService.mapAttendanceAddon(current),
            current: this.plansService.mapAttendanceAddon(updated),
          },
        },
      });

      return this.mapCompanyAttendanceAddon(updated);
    });
  }

  async updateCompanyAttendanceCapacity(
    actor: JwtPayload,
    id: string,
    dto: UpdateCompanyAttendanceCapacityDto,
  ) {
    const empresaId = this.parseId(id, 'empresa');
    const actorId = this.parseId(actor.sub, 'administrador');

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
      const current = await tx.empresa.findUnique({
        where: { id: empresaId },
        select: {
          id: true,
          nombreComercial: true,
          planCodigo: true,
          planInicioAt: true,
          planFinAt: true,
          asistenciasActiva: true,
          asistenciasTrabajadoresLimite: true,
          asistenciasPuntosQrLimite: true,
          asistenciasInicioAt: true,
          asistenciasFinAt: true,
          limitesAdicionales: true,
        },
      });
      if (!current) throw new NotFoundException('Empresa no encontrada');
      if (!this.plansService.mapAttendanceAddon(current).effectiveActive) {
        throw new ConflictException({
          code: 'ATTENDANCE_SUBSCRIPTION_INACTIVE',
          message: 'La empresa no tiene una suscripcion de Asistencias vigente',
        });
      }

      const [activeEmployees, activeQrPoints, activeBranches] =
        await Promise.all([
          tx.empleado.count({ where: { empresaId, estado: 'activo' } }),
          tx.puntoQrAsistencia.count({
            where: { empresaId, estado: 'activo' },
          }),
          tx.sucursal.count({
            where: { empresaId, tipo: SucursalTipo.tienda },
          }),
        ]);
      if (activeEmployees > dto.employeesLimit) {
        throw new ConflictException({
          code: 'ATTENDANCE_EMPLOYEE_LIMIT_BELOW_USAGE',
          message:
            'El limite de trabajadores no puede ser menor al consumo actual',
          used: activeEmployees,
          limit: dto.employeesLimit,
        });
      }
      if (activeQrPoints > dto.qrPointsLimit) {
        throw new ConflictException({
          code: 'ATTENDANCE_QR_LIMIT_BELOW_USAGE',
          message:
            'El limite de puntos QR no puede ser menor al consumo actual',
          used: activeQrPoints,
          limit: dto.qrPointsLimit,
        });
      }
      if (activeBranches > dto.branchesLimit) {
        throw new ConflictException({
          code: 'ATTENDANCE_BRANCH_LIMIT_BELOW_USAGE',
          message:
            'El limite de sucursales no puede ser menor al consumo actual',
          used: activeBranches,
          limit: dto.branchesLimit,
        });
      }

      const pricing = await this.plansService.getAttendancePricing(tx);
      const monthlyTotal = new Prisma.Decimal(pricing.employeeUnitPrice)
        .mul(dto.employeesLimit)
        .plus(
          new Prisma.Decimal(pricing.qrPointUnitPrice).mul(dto.qrPointsLimit),
        );
      const documentQueriesLimit =
        getIncludedAttendanceDocumentQueries(monthlyTotal);
      const baseLimits = await this.plansService.getBaseLimits(
        tx,
        current.planCodigo,
      );
      const additionalBranches = Math.max(
        0,
        dto.branchesLimit - baseLimits.branches,
      );
      const additionalDocumentQueries = Math.max(
        0,
        documentQueriesLimit - baseLimits.documentQueries,
      );
      const limitsData = {
        sucursales: BigInt(additionalBranches),
        consultasDocumento: BigInt(additionalDocumentQueries),
        actualizadoPorId: actorId,
      };
      const additionalLimits = await tx.empresaLimiteAdicional.upsert({
        where: { empresaId },
        create: { empresaId, ...limitsData },
        update: limitsData,
      });
      const updated = await tx.empresa.update({
        where: { id: empresaId },
        data: {
          asistenciasTrabajadoresLimite: BigInt(dto.employeesLimit),
          asistenciasPuntosQrLimite: BigInt(dto.qrPointsLimit),
        },
        select: {
          id: true,
          nombreComercial: true,
          planCodigo: true,
          planInicioAt: true,
          planFinAt: true,
          asistenciasActiva: true,
          asistenciasTrabajadoresLimite: true,
          asistenciasPuntosQrLimite: true,
          asistenciasInicioAt: true,
          asistenciasFinAt: true,
          limitesAdicionales: true,
          _count: {
            select: {
              empleados: { where: { estado: 'activo' } },
              puntosQrAsistencia: { where: { estado: 'activo' } },
              sucursales: { where: { tipo: SucursalTipo.tienda } },
            },
          },
        },
      });

      await tx.platformAuditLog.create({
        data: {
          empresaId,
          usuarioId: actorId,
          category: 'plan',
          action: 'attendance_capacity_updated',
          source: 'admin',
          description: `Capacidad de Asistencias actualizada para ${current.nombreComercial}`,
          metadata: {
            previous: {
              employeesLimit: Number(current.asistenciasTrabajadoresLimite),
              qrPointsLimit: Number(current.asistenciasPuntosQrLimite),
            },
            current: {
              employeesLimit: dto.employeesLimit,
              qrPointsLimit: dto.qrPointsLimit,
              branchesLimit: dto.branchesLimit,
              documentQueriesLimit,
            },
            additionalLimits: this.plansService.mapAdditionalLimits(
              additionalLimits,
            ),
          },
        },
      });

      return this.mapCompanyAttendanceAddon(updated);
    });
  }

  async getCompanyModules(id: string) {
    const empresaId = this.parseId(id, 'empresa');
    const company = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        nombreComercial: true,
        planCodigo: true,
        planInicioAt: true,
        planFinAt: true,
        asistenciasActiva: true,
        asistenciasInicioAt: true,
        asistenciasFinAt: true,
        modulosPlanPersonalizados: true,
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return this.mapCompanyModules(this.prisma, company);
  }

  async updateCompanyModules(
    actor: JwtPayload,
    id: string,
    dto: UpdateCompanyModulesDto,
  ) {
    const empresaId = this.parseId(id, 'empresa');
    const actorId = this.parseId(actor.sub, 'administrador');
    const moduleKeys = this.cleanModuleKeys(dto.moduleKeys);

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
      const company = await tx.empresa.findUnique({
        where: { id: empresaId },
        select: {
          id: true,
          nombreComercial: true,
          planCodigo: true,
          planInicioAt: true,
          planFinAt: true,
          asistenciasActiva: true,
          asistenciasInicioAt: true,
          asistenciasFinAt: true,
          modulosPlanPersonalizados: true,
        },
      });
      if (!company) throw new NotFoundException('Empresa no encontrada');

      const previous = await this.buildCompanyModuleSets(
        tx,
        company,
        company.modulosPlanPersonalizados,
      );
      const selected = new Set(moduleKeys);
      const overrides = userModuleKeys.flatMap((moduleKey) => {
        const selectedValue = selected.has(moduleKey);
        const baseValue = previous.base.has(moduleKey);
        return selectedValue === baseValue
          ? []
          : [
              {
                empresaId,
                moduleKey,
                enabled: selectedValue,
                actualizadoPorId: actorId,
              },
            ];
      });

      await tx.empresaModuloPlan.deleteMany({ where: { empresaId } });
      if (overrides.length) {
        await tx.empresaModuloPlan.createMany({ data: overrides });
      }

      await tx.platformAuditLog.create({
        data: {
          empresaId,
          usuarioId: actorId,
          category: 'plan',
          action: 'company_modules_updated',
          source: 'admin',
          description: `Modulos personalizados actualizados para ${company.nombreComercial}`,
          metadata: {
            previous: Array.from(previous.effective),
            current: moduleKeys,
          },
        },
      });

      const updated = await tx.empresa.findUniqueOrThrow({
        where: { id: empresaId },
        select: {
          id: true,
          nombreComercial: true,
          planCodigo: true,
          planInicioAt: true,
          planFinAt: true,
          asistenciasActiva: true,
          asistenciasInicioAt: true,
          asistenciasFinAt: true,
          modulosPlanPersonalizados: true,
        },
      });
      return this.mapCompanyModules(tx, updated);
    });
  }

  async findOverages(query: FindOveragesQueryDto, now = new Date()) {
    const currentPeriod = getLimaPeriod(now);
    const search = query.search?.trim();
    const status = query.status;
    const base = Prisma.sql`
      WITH grouped AS (
        SELECT v."empresa_id" AS "empresaId",
               to_char(timezone('America/Lima', v."created_at"), 'YYYY-MM') AS "periodo",
               count(*)::bigint AS "cantidad",
               COALESCE(sum(v."precio_excedente_plan"), 0) AS "montoTotal",
               e."nombre_comercial" AS "empresaNombre", e."ruc", e."dni"
        FROM "venta" v
        JOIN "empresa" e ON e."id" = v."empresa_id"
        WHERE v."es_excedente_plan" = true
        GROUP BY v."empresa_id", e."nombre_comercial", e."ruc", e."dni",
                 to_char(timezone('America/Lima', v."created_at"), 'YYYY-MM')
      ), rows AS (
        SELECT grouped.*, l."id" AS "liquidationId",
               COALESCE(l."estado"::text,
                 CASE WHEN grouped."periodo" = ${currentPeriod} THEN 'open' ELSE 'ready' END
               ) AS "rowStatus"
        FROM grouped
        LEFT JOIN "liquidacion_excedente" l
          ON l."empresa_id" = grouped."empresaId"
         AND l."periodo" = grouped."periodo"
      ), filtered AS (
        SELECT * FROM rows
        WHERE (${search ?? null}::text IS NULL OR
               "empresaNombre" ILIKE ${search ? `%${search}%` : null} OR
               COALESCE("ruc", "dni", '') ILIKE ${search ? `%${search}%` : null})
          AND (${query.period ?? null}::text IS NULL OR "periodo" = ${query.period ?? null})
          AND (${status ?? null}::text IS NULL OR "rowStatus" = ${status ?? null})
      )
    `;
    const offset = (query.page - 1) * query.limit;
    const [aggregates, stats] = await Promise.all([
      this.prisma.$queryRaw<OverageAggregate[]>(Prisma.sql`
        ${base}
        SELECT "empresaId", "periodo", "cantidad", "montoTotal",
               "empresaNombre", "ruc", "dni", "liquidationId"
        FROM filtered
        ORDER BY "periodo" DESC, "empresaNombre" ASC, "empresaId" ASC
        LIMIT ${query.limit} OFFSET ${offset}
      `),
      this.prisma.$queryRaw<OverageStats[]>(Prisma.sql`
        ${base}
        SELECT count(*)::bigint AS "total",
               COALESCE(sum("montoTotal") FILTER (WHERE "rowStatus" <> 'pagado'), 0) AS "pendingAmount",
               COALESCE(sum("montoTotal") FILTER (WHERE "rowStatus" = 'pagado'), 0) AS "paidAmount"
        FROM filtered
      `),
    ]);
    const liquidationIds = aggregates.flatMap((item) =>
      item.liquidationId ? [item.liquidationId] : [],
    );
    const liquidations = liquidationIds.length
      ? await this.prisma.liquidacionExcedente.findMany({
          where: { id: { in: liquidationIds } },
          include: liquidationInclude,
        })
      : [];
    const liquidationMap = new Map(
      liquidations.map((item) => [item.id.toString(), item]),
    );
    const data = aggregates.map((item) => {
      const liquidation = item.liquidationId
        ? liquidationMap.get(item.liquidationId.toString())
        : undefined;
      return this.mapOverageRow(item, liquidation, currentPeriod);
    });
    const summary = stats[0] ?? {
      total: 0n,
      pendingAmount: new Prisma.Decimal(0),
      paidAmount: new Prisma.Decimal(0),
    };
    const total = Number(summary.total);
    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
      summary: {
        pendingAmount: summary.pendingAmount.toFixed(2),
        paidAmount: summary.paidAmount.toFixed(2),
      },
    };
  }

  async close(actor: JwtPayload, dto: CloseOverageDto, now = new Date()) {
    const actorId = this.parseId(actor.sub, 'administrador');
    const empresaId = this.parseId(dto.empresaId, 'empresa');
    const range = getPeriodRange(dto.period);
    if (range.end > getPeriodRange(getLimaPeriod(now)).start) {
      throw new BadRequestException('Solo puedes cerrar meses terminados');
    }
    try {
      const result = await this.runSerializable(async (tx) => {
        const duplicate = await tx.liquidacionExcedente.findUnique({
          where: { requestId: dto.requestId },
          include: liquidationInclude,
        });
        if (duplicate) return duplicate;
        await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
        const company = await tx.empresa.findUnique({
          where: { id: empresaId },
        });
        if (!company) throw new NotFoundException('Empresa no encontrada');
        const existing = await tx.liquidacionExcedente.findUnique({
          where: { empresaId_periodo: { empresaId, periodo: dto.period } },
        });
        if (existing) {
          throw new ConflictException({
            code: 'OVERAGE_ALREADY_CLOSED',
            message: 'El periodo ya fue cerrado',
          });
        }
        const total = await tx.venta.aggregate({
          where: {
            empresaId,
            esExcedentePlan: true,
            createdAt: { gte: range.start, lt: range.end },
          },
          _count: { _all: true },
          _sum: { precioExcedentePlan: true },
        });
        if (total._count._all === 0)
          throw new BadRequestException(
            'El periodo no tiene comprobantes excedentes',
          );
        const liquidation = await tx.liquidacionExcedente.create({
          data: {
            requestId: dto.requestId,
            empresaId,
            periodo: dto.period,
            cantidad: total._count._all,
            montoTotal: total._sum.precioExcedentePlan ?? new Prisma.Decimal(0),
            cerradaPorId: actorId,
          },
          include: liquidationInclude,
        });
        await tx.platformAuditLog.create({
          data: {
            empresaId,
            usuarioId: actorId,
            category: 'subscription',
            action: 'overage_closed',
            source: 'admin',
            description: `Excedentes ${dto.period} cerrados para ${company.nombreComercial}`,
            metadata: {
              liquidationId: liquidation.id.toString(),
              period: dto.period,
              quantity: liquidation.cantidad,
              amount: liquidation.montoTotal.toFixed(2),
            },
          },
        });
        return liquidation;
      });
      return this.mapLiquidation(result);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.prisma.liquidacionExcedente.findUnique({
          where: { requestId: dto.requestId },
          include: liquidationInclude,
        });
        if (duplicate) return this.mapLiquidation(duplicate);
      }
      throw error;
    }
  }

  pay(actor: JwtPayload, id: string, dto: PayOverageDto, now = new Date()) {
    const actorId = this.parseId(actor.sub, 'administrador');
    const liquidationId = this.parseId(id, 'liquidacion');
    return this.runSerializable(async (tx) => {
      const duplicate = await tx.liquidacionExcedente.findUnique({
        where: { pagoRequestId: dto.requestId },
        include: liquidationInclude,
      });
      if (duplicate) return this.mapLiquidation(duplicate);
      await tx.$queryRaw`SELECT "id" FROM "liquidacion_excedente" WHERE "id" = ${liquidationId} FOR UPDATE`;
      const current = await tx.liquidacionExcedente.findUnique({
        where: { id: liquidationId },
        include: liquidationInclude,
      });
      if (!current) throw new NotFoundException('Liquidacion no encontrada');
      if (current.estado === LiquidacionExcedenteEstado.pagado) {
        throw new ConflictException({
          code: 'OVERAGE_ALREADY_PAID',
          message: 'La liquidacion ya fue pagada',
        });
      }
      const updated = await tx.liquidacionExcedente.update({
        where: { id: liquidationId },
        data: {
          estado: LiquidacionExcedenteEstado.pagado,
          pagoRequestId: dto.requestId,
          metodoPago: dto.paymentMethod,
          metodoPagoOtro:
            dto.paymentMethod === PagoSuscripcionMetodo.otro
              ? dto.paymentMethodOther
              : null,
          pagadaPorId: actorId,
          pagadoAt: now,
        },
        include: liquidationInclude,
      });
      await this.billingService.createReceiptForOverage(tx, {
        requestId: dto.requestId,
        actorId,
        liquidationId: updated.id,
        empresaId: updated.empresaId,
        type: dto.receiptType,
        description: `Comprobantes excedentes ${updated.periodo}`,
        quantity: updated.cantidad,
        total: updated.montoTotal,
      });
      await tx.platformAuditLog.create({
        data: {
          empresaId: current.empresaId,
          usuarioId: actorId,
          category: 'subscription',
          action: 'overage_paid',
          source: 'admin',
          description: `Excedentes ${current.periodo} pagados por ${current.empresa.nombreComercial}`,
          metadata: {
            liquidationId: current.id.toString(),
            period: current.periodo,
            amount: current.montoTotal.toFixed(2),
            paymentMethod: dto.paymentMethod,
          },
        },
      });
      return this.mapLiquidation(updated);
    });
  }

  private async mapCompanyLimits(company: CompanyWithLimits) {
    const baseLimits = await this.plansService.getBaseLimits(
      this.prisma,
      company.planCodigo,
    );
    const additionalLimits = this.plansService.mapAdditionalLimits(
      company.limitesAdicionales,
    );
    const effectiveLimits = this.plansService.withAttendanceLimits(
      baseLimits,
      additionalLimits,
      company,
    );
    return {
      company: { id: company.id.toString(), name: company.nombreComercial },
      baseLimits,
      additionalLimits,
      effectiveLimits,
      attendance: {
        ...this.plansService.mapAttendanceAddon(
          company,
          await this.plansService.getAttendancePricing(),
        ),
        branchesLimit: effectiveLimits.branches,
        documentQueriesLimit: effectiveLimits.documentQueries,
      },
      updatedAt: company.limitesAdicionales?.updatedAt?.toISOString() ?? null,
    };
  }

  private async mapCompanyModules(
    tx: Prisma.TransactionClient | PrismaService,
    company: {
      id: bigint;
      nombreComercial: string;
      planCodigo: PlanCodigo;
      planInicioAt: Date;
      planFinAt: Date | null;
      asistenciasActiva: boolean;
      asistenciasInicioAt: Date | null;
      asistenciasFinAt: Date | null;
      modulosPlanPersonalizados: {
        moduleKey: string;
        enabled: boolean;
        updatedAt: Date;
      }[];
    },
  ) {
    const sets = await this.buildCompanyModuleSets(
      tx,
      company,
      company.modulosPlanPersonalizados,
    );
    const updatedAt = company.modulosPlanPersonalizados
      .map((module) => module.updatedAt)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      company: { id: company.id.toString(), name: company.nombreComercial },
      planCode: company.planCodigo,
      baseModuleKeys: Array.from(sets.base),
      overrideModuleKeys: company.modulosPlanPersonalizados.map((module) => ({
        moduleKey: module.moduleKey,
        enabled: module.enabled,
      })),
      effectiveModuleKeys: Array.from(sets.effective),
      updatedAt: updatedAt?.toISOString() ?? null,
    };
  }

  private async buildCompanyModuleSets(
    tx: Prisma.TransactionClient | PrismaService,
    company: {
      id: bigint;
      planCodigo: PlanCodigo;
      planInicioAt: Date;
      planFinAt: Date | null;
      asistenciasActiva: boolean;
      asistenciasInicioAt: Date | null;
      asistenciasFinAt: Date | null;
    },
    overrides: { moduleKey: string; enabled: boolean }[],
  ) {
    const attendanceKeys = new Set<string>(
      this.plansService.getDefinition(PlanCodigo.asistencias_basico).moduleKeys,
    );
    const planModules = await tx.planModulo.findMany({
      where: { planCodigo: company.planCodigo, enabled: true },
      select: { moduleKey: true },
    });
    const base = new Set(
      planModules.length
        ? planModules.map((module) => module.moduleKey)
        : this.plansService.getDefinition(company.planCodigo).moduleKeys,
    );
    for (const moduleKey of attendanceKeys) base.delete(moduleKey);
    if (this.plansService.mapAttendanceAddon(company).effectiveActive) {
      for (const moduleKey of attendanceKeys) base.add(moduleKey);
    }
    const effective = new Set(base);
    for (const override of overrides) {
      if (!userModuleKeySet.has(override.moduleKey)) continue;
      if (
        attendanceKeys.has(override.moduleKey) &&
        !this.plansService.mapAttendanceAddon(company).effectiveActive
      ) {
        effective.delete(override.moduleKey);
        continue;
      }
      if (override.enabled) effective.add(override.moduleKey);
      else effective.delete(override.moduleKey);
    }
    return { base, effective };
  }

  private async mapCompanyAttendanceAddon(company: {
    id: bigint;
    nombreComercial: string;
    planCodigo: PlanCodigo;
    planInicioAt: Date;
    planFinAt: Date | null;
    asistenciasActiva: boolean;
    asistenciasTrabajadoresLimite: bigint;
    asistenciasPuntosQrLimite: bigint;
    asistenciasInicioAt: Date | null;
    asistenciasFinAt: Date | null;
    limitesAdicionales?: CompanyWithLimits['limitesAdicionales'];
    _count?: {
      empleados: number;
      puntosQrAsistencia: number;
      sucursales?: number;
    };
  }) {
    const pricing = await this.plansService.getAttendancePricing();
    const baseLimits = await this.plansService.getBaseLimits(
      this.prisma,
      company.planCodigo,
    );
    const effectiveLimits = this.plansService.withAttendanceLimits(
      baseLimits,
      this.plansService.mapAdditionalLimits(company.limitesAdicionales),
      company,
    );
    const documentRange = this.plansService.getDocumentRange(
      company,
      new Date(),
    );
    const documentQueries = await this.prisma.consultaDocumento.count({
      where: {
        empresaId: company.id,
        createdAt: {
          gte: documentRange.start,
          ...(documentRange.end ? { lt: documentRange.end } : {}),
        },
      },
    });
    return {
      company: { id: company.id.toString(), name: company.nombreComercial },
      pricing,
      ...this.plansService.mapAttendanceAddon(company, pricing),
      branchesLimit: effectiveLimits.branches,
      documentQueriesLimit: effectiveLimits.documentQueries,
      usage: {
        employees: company._count?.empleados ?? 0,
        qrPoints: company._count?.puntosQrAsistencia ?? 0,
        branches: company._count?.sucursales ?? 0,
        documentQueries,
      },
    };
  }

  private cleanModuleKeys(moduleKeys: string[]) {
    const cleaned = Array.from(
      new Set(moduleKeys.map((moduleKey) => moduleKey.trim()).filter(Boolean)),
    );
    const invalid = cleaned.find(
      (moduleKey) => !userModuleKeySet.has(moduleKey),
    );
    if (invalid) {
      throw new BadRequestException(`El modulo ${invalid} no existe`);
    }
    return cleaned;
  }

  private mapOverageRow(
    item: OverageAggregate,
    liquidation: Liquidation | undefined,
    currentPeriod: string,
  ) {
    return {
      company: {
        id: item.empresaId.toString(),
        name: item.empresaNombre,
        document: item.ruc ?? item.dni,
      },
      period: item.periodo,
      quantity: Number(item.cantidad),
      totalAmount: item.montoTotal.toFixed(2),
      currency: 'PEN' as const,
      status:
        liquidation?.estado ??
        (item.periodo === currentPeriod ? 'open' : 'ready'),
      liquidation: liquidation ? this.mapLiquidation(liquidation) : null,
    };
  }

  private mapLiquidation(item: Liquidation) {
    const user = (
      value: {
        id: bigint;
        nombre: string;
        apellido: string | null;
        email: string;
      } | null,
    ) =>
      value
        ? {
            id: value.id.toString(),
            name: [value.nombre, value.apellido].filter(Boolean).join(' '),
            email: value.email,
          }
        : null;
    return {
      id: item.id.toString(),
      requestId: item.requestId,
      company: {
        id: item.empresa.id.toString(),
        name: item.empresa.nombreComercial,
        document: item.empresa.ruc ?? item.empresa.dni,
      },
      period: item.periodo,
      quantity: item.cantidad,
      totalAmount: item.montoTotal.toFixed(2),
      currency: item.moneda,
      includesIgv: item.incluyeIgv,
      status: item.estado,
      paymentMethod: item.metodoPago,
      paymentMethodOther: item.metodoPagoOtro,
      closedBy: user(item.cerradaPor),
      paidBy: user(item.pagadaPor),
      paidAt: item.pagadoAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      receipt: item.comprobante
        ? {
            id: item.comprobante.id.toString(),
            type: item.comprobante.tipo,
            correlativo: `${item.comprobante.serie}-${String(item.comprobante.numero).padStart(8, '0')}`,
            status: item.comprobante.estado,
          }
        : null,
    };
  }

  private parseId(value: string, label: string) {
    try {
      const id = BigInt(value);
      if (id <= 0n) throw new Error();
      return id;
    } catch {
      throw new BadRequestException(
        `El identificador de ${label} no es valido`,
      );
    }
  }

  private runSerializable<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }
}

export function getIncludedAttendanceDocumentQueries(
  monthlyTotal: Prisma.Decimal,
) {
  if (monthlyTotal.greaterThanOrEqualTo(100)) return 800;
  if (monthlyTotal.greaterThanOrEqualTo(60)) return 300;
  if (monthlyTotal.greaterThanOrEqualTo(30)) return 100;
  return 20;
}

type ExtraLimits = {
  users: number;
  branches: number;
  warehouses: number;
  products: number;
  variants: number;
  documents: number;
  documentQueries: number;
  storageBytes: number;
  attendanceEmployees: number;
  attendanceQrPoints: number;
};

export function describeLimitIncreases(
  previous: ExtraLimits,
  current: ExtraLimits,
) {
  const resources: {
    key: keyof ExtraLimits;
    label: string;
    format?: (value: number) => string;
  }[] = [
    { key: 'users', label: 'usuarios' },
    { key: 'branches', label: 'sucursales' },
    { key: 'warehouses', label: 'almacenes' },
    { key: 'products', label: 'productos' },
    { key: 'variants', label: 'variantes' },
    { key: 'documents', label: 'comprobantes' },
    { key: 'documentQueries', label: 'consultas DNI/RUC' },
    { key: 'storageBytes', label: 'almacenamiento', format: formatStorage },
    { key: 'attendanceEmployees', label: 'trabajadores' },
    { key: 'attendanceQrPoints', label: 'puntos QR' },
  ];

  return resources.flatMap(({ key, label, format }) => {
    const increase = current[key] - previous[key];
    return increase > 0
      ? [
          `${label} +${format ? format(increase) : increase.toLocaleString('es-PE')}`,
        ]
      : [];
  });
}

function formatStorage(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1024
    ? `${(megabytes / 1024).toLocaleString('es-PE')} GB`
    : `${megabytes.toLocaleString('es-PE')} MB`;
}

function getLimaPeriod(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
  }).format(date);
}

function getPeriodRange(period: string) {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12)
    throw new BadRequestException('Periodo no valido');
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 5)),
    end: new Date(Date.UTC(year, month, 1, 5)),
  };
}
