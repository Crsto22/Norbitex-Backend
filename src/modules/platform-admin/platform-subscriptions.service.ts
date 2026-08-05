import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmpresaEstado,
  PagoSuscripcionEstado,
  PagoSuscripcionMetodo,
  Prisma,
  PlataformaComprobanteTipo,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { calculatePlanSalePricing, PlansService } from '../plans/plans.service';
import {
  CancelSubscriptionSaleDto,
  CreateSubscriptionSaleDto,
  FindSubscriptionSalesQueryDto,
} from './dto/platform-subscription-sales.dto';
import { PlatformBillingService } from '../platform-billing/platform-billing.service';
import {
  calculateAffiliatePricing,
  PlatformAffiliatesService,
} from './platform-affiliates.service';

const limaOffsetMs = 5 * 60 * 60 * 1000;
const saleInclude = {
  empresa: {
    select: {
      id: true,
      nombreComercial: true,
      ruc: true,
      dni: true,
    },
  },
  registradoPor: {
    select: {
      id: true,
      nombre: true,
      apellido: true,
      email: true,
    },
  },
  anuladoPor: {
    select: {
      id: true,
      nombre: true,
      apellido: true,
      email: true,
    },
  },
  comprobante: {
    select: { id: true, tipo: true, serie: true, numero: true, estado: true },
  },
} satisfies Prisma.PagoSuscripcionInclude;

type SubscriptionSale = Prisma.PagoSuscripcionGetPayload<{
  include: typeof saleInclude;
}>;

@Injectable()
export class PlatformSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly billingService: PlatformBillingService,
    private readonly affiliatesService: PlatformAffiliatesService,
  ) {}

  async findSales(query: FindSubscriptionSalesQueryDto, now = new Date()) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const where = this.buildWhere(query);
    const monthStart = getLimaMonthStart(now);
    const [sales, total, paidThisMonth, cancelledThisMonth, collected] =
      await Promise.all([
        this.prisma.pagoSuscripcion.findMany({
          where,
          include: saleInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.pagoSuscripcion.count({ where }),
        this.prisma.pagoSuscripcion.count({
          where: {
            estado: PagoSuscripcionEstado.pagado,
            createdAt: { gte: monthStart },
          },
        }),
        this.prisma.pagoSuscripcion.count({
          where: {
            estado: PagoSuscripcionEstado.anulado,
            anuladoAt: { gte: monthStart },
          },
        }),
        this.prisma.pagoSuscripcion.aggregate({
          where: {
            estado: PagoSuscripcionEstado.pagado,
            createdAt: { gte: monthStart },
          },
          _sum: { montoTotal: true },
        }),
      ]);

    return {
      data: sales.map((sale) => this.mapSale(sale)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      summary: {
        paidThisMonth,
        cancelledThisMonth,
        collectedThisMonth: (
          collected._sum.montoTotal ?? new Prisma.Decimal(0)
        ).toFixed(2),
      },
    };
  }

  async createSale(
    actor: JwtPayload,
    dto: CreateSubscriptionSaleDto,
    now = new Date(),
  ) {
    const actorId = this.parseId(actor.sub, 'administrador');
    const empresaId = this.parseId(dto.empresaId, 'empresa');

    try {
      const result = await this.runSerializable(async (tx) => {
        const duplicate = await tx.pagoSuscripcion.findUnique({
          where: { requestId: dto.requestId },
          include: saleInclude,
        });

        if (duplicate) {
          return { sale: duplicate, idempotent: true };
        }

        await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
        const company = await tx.empresa.findUnique({
          where: { id: empresaId },
          select: {
            id: true,
            nombreComercial: true,
            estado: true,
            planCodigo: true,
            planInicioAt: true,
            planFinAt: true,
          },
        });

        if (!company) {
          throw new NotFoundException('Empresa no encontrada');
        }
        if (company.estado !== EmpresaEstado.activa) {
          throw new ConflictException({
            code: 'COMPANY_NOT_ACTIVE',
            message: 'La empresa debe estar activa para venderle un plan',
          });
        }

        await tx.$queryRaw`SELECT "plan_codigo" FROM "tarifa_plan" WHERE "plan_codigo" = CAST(${dto.planCode} AS "PlanCodigo") FOR UPDATE`;
        const definition = await this.plansService.getCommercialDefinition(
          dto.planCode,
          tx,
        );
        if (definition.pricingUpdatedAt !== dto.pricingUpdatedAt) {
          throw new ConflictException({
            code: 'PLAN_PRICING_CHANGED',
            message: 'La tarifa del plan cambio. Revisa el importe nuevamente',
          });
        }
        const price = new Prisma.Decimal(definition.priceMonthly);
        const paidSubscriptions = await tx.pagoSuscripcion.count({
          where: {
            empresaId: company.id,
            estado: PagoSuscripcionEstado.pagado,
          },
        });
        const amounts = calculatePlanSalePricing(
          price,
          paidSubscriptions === 0
            ? new Prisma.Decimal(definition.monthlyDiscountPercent)
            : new Prisma.Decimal(0),
          new Prisma.Decimal(definition.annualDiscountPercent),
          dto.months,
        );
        const affiliate = await this.affiliatesService.resolveSaleContext(
          tx,
          company,
          dto.affiliateCode,
          now,
          true,
          actorId,
        );
        const affiliateDiscountPercent =
          affiliate?.discountPercent ?? new Prisma.Decimal(0);
        const commissionPercent =
          affiliate?.commissionPercent ?? new Prisma.Decimal(0);
        const affiliateAmounts = calculateAffiliatePricing(
          amounts.total,
          affiliateDiscountPercent,
          commissionPercent,
        );
        const affiliateDiscountAmount = affiliateAmounts.discountAmount;
        const finalTotal = affiliateAmounts.total;
        const commissionAmount = affiliateAmounts.commissionAmount;
        const extendsCurrentPlan =
          company.planCodigo === dto.planCode &&
          Boolean(company.planFinAt && company.planFinAt > now);
        const coverageStartsAt = extendsCurrentPlan ? company.planFinAt! : now;
        const resultingStartsAt = extendsCurrentPlan
          ? company.planInicioAt
          : now;
        const resultingEndsAt = addCalendarMonthsClamped(
          coverageStartsAt,
          dto.months,
        );

        await tx.empresa.update({
          where: { id: company.id },
          data: {
            planCodigo: dto.planCode,
            planInicioAt: resultingStartsAt,
            planFinAt: resultingEndsAt,
          },
        });
        const sale = await tx.pagoSuscripcion.create({
          data: {
            requestId: dto.requestId,
            empresaId: company.id,
            registradoPorId: actorId,
            planCodigo: dto.planCode,
            meses: dto.months,
            precioMensual: price,
            montoLista: amounts.listAmount,
            descuentoPorcentaje: amounts.discountPercent,
            montoDescuento: amounts.discountAmount,
            afiliadoId: affiliate?.id,
            afiliadoCodigo: affiliate?.code,
            descuentoAfiliadoPorcentaje: affiliateDiscountPercent,
            montoDescuentoAfiliado: affiliateDiscountAmount,
            baseComisionAfiliado: affiliate ? finalTotal : 0,
            comisionAfiliadoPorcentaje: commissionPercent,
            montoComisionAfiliado: commissionAmount,
            montoTotal: finalTotal,
            metodoPago: dto.paymentMethod,
            metodoPagoOtro:
              dto.paymentMethod === PagoSuscripcionMetodo.otro
                ? dto.paymentMethodOther
                : null,
            planAnteriorCodigo: company.planCodigo,
            planAnteriorInicioAt: company.planInicioAt,
            planAnteriorFinAt: company.planFinAt,
            vigenciaInicioAt: coverageStartsAt,
            vigenciaFinAt: resultingEndsAt,
            planResultanteInicioAt: resultingStartsAt,
            planResultanteFinAt: resultingEndsAt,
          },
          include: saleInclude,
        });

        if (affiliate) {
          await this.affiliatesService.recordSale(tx, {
            companyId: company.id,
            paymentId: sale.id,
            context: affiliate,
            base: finalTotal,
            commission: commissionAmount,
            now,
            actorId,
          });
        }

        await this.billingService.createReceiptForSubscription(tx, {
          requestId: dto.requestId,
          actorId,
          paymentId: sale.id,
          empresaId: company.id,
          type: dto.receiptType,
          description: `Suscripcion ${definition.name} por ${dto.months} mes(es)`,
          total: finalTotal,
        });

        await tx.platformAuditLog.create({
          data: {
            empresaId: company.id,
            usuarioId: actorId,
            category: 'subscription',
            action: 'subscription_sold',
            source: 'admin',
            description: `Suscripcion ${definition.name} vendida a ${company.nombreComercial}`,
            metadata: {
              paymentId: sale.id.toString(),
              fromPlan: company.planCodigo,
              toPlan: dto.planCode,
              months: dto.months,
              paymentMethod: dto.paymentMethod,
              listAmount: amounts.listAmount.toFixed(2),
              discountPercent: amounts.discountPercent.toFixed(2),
              discountAmount: amounts.discountAmount.toFixed(2),
              affiliateCode: affiliate?.code ?? null,
              affiliateDiscountAmount: affiliateDiscountAmount.toFixed(2),
              affiliateCommissionAmount: commissionAmount.toFixed(2),
              amount: finalTotal.toFixed(2),
              currency: 'PEN',
              startsAt: resultingStartsAt.toISOString(),
              endsAt: resultingEndsAt.toISOString(),
            },
          },
        });

        return { sale, idempotent: false };
      });

      return {
        sale: this.mapSale(result.sale),
        idempotent: result.idempotent,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.pagoSuscripcion.findUnique({
          where: { requestId: dto.requestId },
          include: saleInclude,
        });
        if (existing) {
          return { sale: this.mapSale(existing), idempotent: true };
        }
      }
      throw error;
    }
  }

  async cancelSale(
    actor: JwtPayload,
    id: string,
    dto: CancelSubscriptionSaleDto,
    now = new Date(),
  ) {
    const actorId = this.parseId(actor.sub, 'administrador');
    const saleId = this.parseId(id, 'pago');

    const sale = await this.runSerializable(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "pago_suscripcion" WHERE "id" = ${saleId} FOR UPDATE`;
      const currentSale = await tx.pagoSuscripcion.findUnique({
        where: { id: saleId },
        include: saleInclude,
      });

      if (!currentSale) {
        throw new NotFoundException('Pago de suscripcion no encontrado');
      }
      if (currentSale.estado === PagoSuscripcionEstado.anulado) {
        throw new ConflictException({
          code: 'SUBSCRIPTION_SALE_ALREADY_CANCELLED',
          message: 'El pago ya fue anulado',
        });
      }

      await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${currentSale.empresaId} FOR UPDATE`;
      const [company, latestPaid] = await Promise.all([
        tx.empresa.findUnique({
          where: { id: currentSale.empresaId },
          select: {
            planCodigo: true,
            planInicioAt: true,
            planFinAt: true,
          },
        }),
        tx.pagoSuscripcion.findFirst({
          where: {
            empresaId: currentSale.empresaId,
            estado: PagoSuscripcionEstado.pagado,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        }),
      ]);

      if (
        !company ||
        latestPaid?.id !== currentSale.id ||
        company.planCodigo !== currentSale.planCodigo ||
        !sameDate(company.planInicioAt, currentSale.planResultanteInicioAt) ||
        !sameDate(company.planFinAt, currentSale.planResultanteFinAt)
      ) {
        throw new ConflictException({
          code: 'SUBSCRIPTION_SALE_NOT_CURRENT',
          message:
            'El pago no puede revertirse porque existe un cambio posterior',
        });
      }

      await tx.empresa.update({
        where: { id: currentSale.empresaId },
        data: {
          planCodigo: currentSale.planAnteriorCodigo,
          planInicioAt: currentSale.planAnteriorInicioAt,
          planFinAt: currentSale.planAnteriorFinAt,
        },
      });
      const updated = await tx.pagoSuscripcion.update({
        where: { id: currentSale.id },
        data: {
          estado: PagoSuscripcionEstado.anulado,
          motivoAnulacion: dto.reason,
          anuladoAt: now,
          anuladoPorId: actorId,
        },
        include: saleInclude,
      });
      await this.affiliatesService.cancelSaleCommission(
        tx,
        currentSale.id,
        currentSale.empresaId,
        now,
      );
      if (currentSale.comprobante) {
        if (
          currentSale.comprobante.tipo !== PlataformaComprobanteTipo.nota_venta
        ) {
          throw new ConflictException({
            code: 'ELECTRONIC_CREDIT_NOTE_REQUIRED',
            message: 'Emite una nota de credito para anular este pago',
          });
        }
        await tx.comprobantePlataforma.update({
          where: { id: currentSale.comprobante.id },
          data: { estado: 'anulado', sunatMensaje: dto.reason },
        });
      }

      await tx.platformAuditLog.create({
        data: {
          empresaId: currentSale.empresaId,
          usuarioId: actorId,
          category: 'subscription',
          action: 'subscription_sale_cancelled',
          source: 'admin',
          description: `Pago de suscripcion anulado para ${currentSale.empresa.nombreComercial}`,
          metadata: {
            paymentId: currentSale.id.toString(),
            restoredPlan: currentSale.planAnteriorCodigo,
            restoredStartsAt: currentSale.planAnteriorInicioAt.toISOString(),
            restoredEndsAt:
              currentSale.planAnteriorFinAt?.toISOString() ?? null,
            reason: dto.reason,
          },
        },
      });

      return updated;
    });

    return this.mapSale(sale);
  }

  private buildWhere(
    query: FindSubscriptionSalesQueryDto,
  ): Prisma.PagoSuscripcionWhereInput {
    const search = query.search?.trim();
    const from = query.dateFrom
      ? new Date(`${query.dateFrom}T00:00:00-05:00`)
      : undefined;
    const to = query.dateTo
      ? new Date(`${query.dateTo}T00:00:00-05:00`)
      : undefined;

    if (from && to && from > to) {
      throw new BadRequestException(
        'La fecha inicial no puede ser posterior a la fecha final',
      );
    }
    if (to) {
      to.setUTCDate(to.getUTCDate() + 1);
    }

    return {
      ...(query.plan ? { planCodigo: query.plan } : {}),
      ...(query.method ? { metodoPago: query.method } : {}),
      ...(query.status ? { estado: query.status } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lt: to } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              {
                empresa: {
                  nombreComercial: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              { empresa: { ruc: { contains: search } } },
              { empresa: { dni: { contains: search } } },
              {
                registradoPor: {
                  email: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
  }

  private mapSale(sale: SubscriptionSale) {
    const mapUser = (user: SubscriptionSale['registradoPor'] | null) =>
      user
        ? {
            id: user.id.toString(),
            name: [user.nombre, user.apellido].filter(Boolean).join(' '),
            email: user.email,
          }
        : null;

    return {
      id: sale.id.toString(),
      requestId: sale.requestId,
      company: {
        id: sale.empresa.id.toString(),
        name: sale.empresa.nombreComercial,
        document: sale.empresa.ruc ?? sale.empresa.dni,
      },
      planCode: sale.planCodigo,
      planName: this.plansService.getDefinition(sale.planCodigo).name,
      months: sale.meses,
      monthlyPrice: sale.precioMensual.toFixed(2),
      listAmount: sale.montoLista.toFixed(2),
      discountPercent: sale.descuentoPorcentaje.toFixed(2),
      discountAmount: sale.montoDescuento.toFixed(2),
      affiliateCode: sale.afiliadoCodigo,
      affiliateDiscountPercent: sale.descuentoAfiliadoPorcentaje.toFixed(2),
      affiliateDiscountAmount: sale.montoDescuentoAfiliado.toFixed(2),
      affiliateCommissionBase: sale.baseComisionAfiliado.toFixed(2),
      affiliateCommissionPercent: sale.comisionAfiliadoPorcentaje.toFixed(2),
      affiliateCommissionAmount: sale.montoComisionAfiliado.toFixed(2),
      totalAmount: sale.montoTotal.toFixed(2),
      currency: sale.moneda,
      includesIgv: sale.incluyeIgv,
      paymentMethod: sale.metodoPago,
      paymentMethodOther: sale.metodoPagoOtro,
      status: sale.estado,
      previousPlanCode: sale.planAnteriorCodigo,
      previousStartsAt: sale.planAnteriorInicioAt.toISOString(),
      previousEndsAt: sale.planAnteriorFinAt?.toISOString() ?? null,
      coverageStartsAt: sale.vigenciaInicioAt.toISOString(),
      coverageEndsAt: sale.vigenciaFinAt.toISOString(),
      resultingStartsAt: sale.planResultanteInicioAt.toISOString(),
      resultingEndsAt: sale.planResultanteFinAt.toISOString(),
      registeredBy: mapUser(sale.registradoPor),
      cancelledBy: mapUser(sale.anuladoPor),
      cancellationReason: sale.motivoAnulacion,
      cancelledAt: sale.anuladoAt?.toISOString() ?? null,
      createdAt: sale.createdAt.toISOString(),
      receipt: sale.comprobante
        ? {
            id: sale.comprobante.id.toString(),
            type: sale.comprobante.tipo,
            correlativo: `${sale.comprobante.serie}-${String(sale.comprobante.numero).padStart(8, '0')}`,
            status: sale.comprobante.estado,
          }
        : null,
    };
  }

  private parseId(value: string, resource: string) {
    try {
      const id = BigInt(value);
      if (id <= 0n) throw new Error();
      return id;
    } catch {
      throw new BadRequestException(`Identificador de ${resource} invalido`);
    }
  }

  private async runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!isSerializationConflict(error) || attempt === 2) {
          throw error;
        }
      }
    }

    throw new ConflictException('No se pudo completar la operacion');
  }
}

export function addCalendarMonthsClamped(value: Date, months: number) {
  const limaDate = new Date(value.getTime() - limaOffsetMs);
  const day = limaDate.getUTCDate();
  limaDate.setUTCDate(1);
  limaDate.setUTCMonth(limaDate.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(limaDate.getUTCFullYear(), limaDate.getUTCMonth() + 1, 0),
  ).getUTCDate();
  limaDate.setUTCDate(Math.min(day, lastDay));
  return new Date(limaDate.getTime() + limaOffsetMs);
}

function getLimaMonthStart(value: Date) {
  const limaDate = new Date(value.getTime() - limaOffsetMs);
  return new Date(
    Date.UTC(limaDate.getUTCFullYear(), limaDate.getUTCMonth(), 1, 5),
  );
}

function sameDate(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

export function isSerializationConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      (error.code === 'P2010' && error.meta?.code === '40001'))
  );
}
