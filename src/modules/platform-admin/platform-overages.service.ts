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
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PlansService } from '../plans/plans.service';
import {
  CloseOverageDto,
  FindOveragesQueryDto,
  PayOverageDto,
  UpdateCompanyExtraLimitsDto,
} from './dto/platform-overages.dto';
import { PlatformBillingService } from '../platform-billing/platform-billing.service';
import { NotificationsService } from '../notifications/notifications.service';

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
  limitesAdicionales: {
    usuarios: bigint;
    sucursales: bigint;
    almacenes: bigint;
    productos: bigint;
    variantes: bigint;
    comprobantes: bigint;
    consultasDocumento: bigint;
    almacenamientoBytes: bigint;
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
    return {
      company: { id: company.id.toString(), name: company.nombreComercial },
      baseLimits,
      additionalLimits,
      effectiveLimits: this.plansService.buildEffectiveLimits(
        baseLimits,
        additionalLimits,
      ),
      updatedAt: company.limitesAdicionales?.updatedAt?.toISOString() ?? null,
    };
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

type ExtraLimits = {
  users: number;
  branches: number;
  warehouses: number;
  products: number;
  variants: number;
  documents: number;
  documentQueries: number;
  storageBytes: number;
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
