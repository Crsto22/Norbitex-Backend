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
  SuscripcionAsistenciaEstado,
  SuscripcionAsistenciaPeriodo,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { calculatePlanSalePricing, PlansService } from '../plans/plans.service';
import {
  CancelSubscriptionSaleDto,
  CreateAttendanceSubscriptionDto,
  CreateSubscriptionCheckoutDto,
  CreateSubscriptionSaleDto,
  FindAttendanceSubscriptionsQueryDto,
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

const attendanceSubscriptionInclude = {
  empresa: {
    select: {
      id: true,
      nombreComercial: true,
      ruc: true,
      dni: true,
      _count: {
        select: {
          empleados: { where: { estado: 'activo' } },
          puntosQrAsistencia: { where: { estado: 'activo' } },
        },
      },
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
} satisfies Prisma.SuscripcionAsistenciaInclude;

type AttendanceSubscription = Prisma.SuscripcionAsistenciaGetPayload<{
  include: typeof attendanceSubscriptionInclude;
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
            asistenciasFinAt: true,
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

  async createCheckout(
    actor: JwtPayload,
    dto: CreateSubscriptionCheckoutDto,
    now = new Date(),
  ) {
    if (!dto.pos && !dto.attendance) {
      throw new BadRequestException('Selecciona POS, Asistencias o ambos');
    }
    const actorId = this.parseId(actor.sub, 'administrador');
    const empresaId = this.parseId(dto.empresaId, 'empresa');

    try {
      const result = await this.runSerializable(async (tx) => {
        const [duplicateSale, duplicateAttendance] = await Promise.all([
          tx.pagoSuscripcion.findUnique({
            where: { requestId: dto.requestId },
            include: saleInclude,
          }),
          tx.suscripcionAsistencia.findUnique({
            where: { requestId: dto.requestId },
            include: attendanceSubscriptionInclude,
          }),
        ]);
        if (duplicateSale || duplicateAttendance) {
          return {
            sale: duplicateSale,
            attendance: duplicateAttendance,
            receipt: null,
            idempotent: true,
          };
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
            asistenciasActiva: true,
            asistenciasTrabajadoresLimite: true,
            asistenciasPuntosQrLimite: true,
            asistenciasInicioAt: true,
            asistenciasFinAt: true,
          },
        });
        if (!company) throw new NotFoundException('Empresa no encontrada');
        if (company.estado !== EmpresaEstado.activa) {
          throw new ConflictException({
            code: 'COMPANY_NOT_ACTIVE',
            message:
              'La empresa debe estar activa para venderle una suscripcion',
          });
        }

        let sale: SubscriptionSale | null = null;
        let attendance: AttendanceSubscription | null = null;
        const items: Array<{
          description: string;
          quantity: Prisma.Decimal;
          total: Prisma.Decimal;
        }> = [];
        const posItems: typeof items = [];
        const attendanceItems: typeof items = [];
        let total = new Prisma.Decimal(0);
        const affiliate = await this.affiliatesService.resolveSaleContext(
          tx,
          company,
          dto.affiliateCode ?? dto.pos?.affiliateCode,
          now,
          true,
          actorId,
        );
        const affiliateDiscountPercent =
          affiliate?.discountPercent ?? new Prisma.Decimal(0);
        const commissionPercent =
          affiliate?.commissionPercent ?? new Prisma.Decimal(0);

        if (dto.pos) {
          await tx.$queryRaw`SELECT "plan_codigo" FROM "tarifa_plan" WHERE "plan_codigo" = CAST(${dto.pos.planCode} AS "PlanCodigo") FOR UPDATE`;
          const definition = await this.plansService.getCommercialDefinition(
            dto.pos.planCode,
            tx,
          );
          if (definition.pricingUpdatedAt !== dto.pos.pricingUpdatedAt) {
            throw new ConflictException({
              code: 'PLAN_PRICING_CHANGED',
              message:
                'La tarifa del plan cambio. Revisa el importe nuevamente',
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
            dto.pos.months,
          );
          const extendsCurrentPlan =
            company.planCodigo === dto.pos.planCode &&
            Boolean(company.planFinAt && company.planFinAt > now);
          const coverageStartsAt = extendsCurrentPlan
            ? company.planFinAt!
            : now;
          const resultingStartsAt = extendsCurrentPlan
            ? company.planInicioAt
            : now;
          const resultingEndsAt = addCalendarMonthsClamped(
            coverageStartsAt,
            dto.pos.months,
          );

          await tx.empresa.update({
            where: { id: company.id },
            data: {
              planCodigo: dto.pos.planCode,
              planInicioAt: resultingStartsAt,
              planFinAt: resultingEndsAt,
            },
          });
          sale = await tx.pagoSuscripcion.create({
            data: {
              requestId: dto.requestId,
              empresaId: company.id,
              registradoPorId: actorId,
              planCodigo: dto.pos.planCode,
              meses: dto.pos.months,
              precioMensual: price,
              montoLista: amounts.listAmount,
              descuentoPorcentaje: amounts.discountPercent,
              montoDescuento: amounts.discountAmount,
              afiliadoId: affiliate?.id,
              afiliadoCodigo: affiliate?.code,
              descuentoAfiliadoPorcentaje: affiliateDiscountPercent,
              montoDescuentoAfiliado: 0,
              baseComisionAfiliado: 0,
              comisionAfiliadoPorcentaje: commissionPercent,
              montoComisionAfiliado: 0,
              montoTotal: amounts.total,
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
          const item = {
            description: `Plan POS ${definition.name} por ${dto.pos.months} mes(es)`,
            quantity: new Prisma.Decimal(1),
            total: amounts.total,
          };
          items.push(item);
          posItems.push(item);
          total = total.plus(amounts.total);
        }

        if (dto.attendance) {
          const [pricing, activeEmployees, activeQrPoints] = await Promise.all([
            tx.tarifaAsistencia.findUnique({ where: { id: 1 } }),
            tx.empleado.count({ where: { empresaId, estado: 'activo' } }),
            tx.puntoQrAsistencia.count({
              where: { empresaId, estado: 'activo' },
            }),
          ]);
          if (!pricing) {
            throw new NotFoundException('Tarifa de Asistencias no configurada');
          }
          this.assertAttendanceCapacity(
            activeEmployees,
            activeQrPoints,
            dto.attendance.employeesLimit,
            dto.attendance.qrPointsLimit,
          );
          const coverageStartsAt = dto.attendance.startsAt
            ? new Date(dto.attendance.startsAt)
            : now;
          const months =
            dto.attendance.months ??
            (dto.attendance.period === SuscripcionAsistenciaPeriodo.anual
              ? 12
              : 1);
          const period =
            months === 12
              ? SuscripcionAsistenciaPeriodo.anual
              : SuscripcionAsistenciaPeriodo.mensual;
          const coverageEndsAt = addCalendarMonthsClamped(
            coverageStartsAt,
            months,
          );
          const monthlyAmount = pricing.precioTrabajador
            .mul(dto.attendance.employeesLimit)
            .plus(pricing.precioPuntoQr.mul(dto.attendance.qrPointsLimit))
            .toDecimalPlaces(2);
          const totalAmount = monthlyAmount.mul(months).toDecimalPlaces(2);

          await tx.empresa.update({
            where: { id: empresaId },
            data: {
              asistenciasActiva: true,
              asistenciasTrabajadoresLimite: BigInt(
                dto.attendance.employeesLimit,
              ),
              asistenciasPuntosQrLimite: BigInt(dto.attendance.qrPointsLimit),
              asistenciasInicioAt: coverageStartsAt,
              asistenciasFinAt: coverageEndsAt,
            },
          });
          attendance = await tx.suscripcionAsistencia.create({
            data: {
              requestId: dto.requestId,
              empresaId,
              registradoPorId: actorId,
              trabajadoresLimite: BigInt(dto.attendance.employeesLimit),
              puntosQrLimite: BigInt(dto.attendance.qrPointsLimit),
              precioTrabajadorSnapshot: pricing.precioTrabajador,
              precioPuntoQrSnapshot: pricing.precioPuntoQr,
              periodo: period,
              montoMensual: monthlyAmount,
              montoTotal: totalAmount,
              afiliadoId: affiliate?.id,
              afiliadoCodigo: affiliate?.code,
              descuentoAfiliadoPorcentaje: affiliateDiscountPercent,
              montoDescuentoAfiliado: 0,
              baseComisionAfiliado: 0,
              comisionAfiliadoPorcentaje: commissionPercent,
              montoComisionAfiliado: 0,
              metodoPago: dto.paymentMethod,
              metodoPagoOtro:
                dto.paymentMethod === PagoSuscripcionMetodo.otro
                  ? dto.paymentMethodOther
                  : null,
              vigenciaInicioAt: coverageStartsAt,
              vigenciaFinAt: coverageEndsAt,
              limiteAnteriorTrabajadores: company.asistenciasTrabajadoresLimite,
              limiteAnteriorPuntosQr: company.asistenciasPuntosQrLimite,
              asistenciaAnteriorActiva: company.asistenciasActiva,
              asistenciaAnteriorInicioAt: company.asistenciasInicioAt,
              asistenciaAnteriorFinAt: company.asistenciasFinAt,
            },
            include: attendanceSubscriptionInclude,
          });
          const attendanceItem = {
            description: `Servicio de asistencia - ${months} mes(es) - ${dto.attendance.employeesLimit} trabajador(es) - ${dto.attendance.qrPointsLimit} punto(s) QR`,
            quantity: new Prisma.Decimal(1),
            total: totalAmount,
          };
          items.push(attendanceItem);
          attendanceItems.push(attendanceItem);
          total = total.plus(totalAmount);
        }

        const affiliateAmounts = calculateAffiliatePricing(
          total,
          affiliateDiscountPercent,
          commissionPercent,
        );
        const posBase = sumItems(posItems);
        const attendanceBase = sumItems(attendanceItems);
        const posDiscount =
          sale && attendance
            ? proportionalAmount(
                affiliateAmounts.discountAmount,
                posBase,
                total,
              )
            : sale
              ? affiliateAmounts.discountAmount
              : new Prisma.Decimal(0);
        const attendanceDiscount = affiliateAmounts.discountAmount
          .minus(posDiscount)
          .toDecimalPlaces(2);
        const posTotal = posBase.minus(posDiscount).toDecimalPlaces(2);
        const attendanceTotal = attendanceBase
          .minus(attendanceDiscount)
          .toDecimalPlaces(2);
        applyDiscount(posItems, posDiscount);
        applyDiscount(attendanceItems, attendanceDiscount);

        const posCommission =
          sale && attendance
            ? proportionalAmount(
                affiliateAmounts.commissionAmount,
                posTotal,
                affiliateAmounts.total,
              )
            : sale
              ? affiliateAmounts.commissionAmount
              : new Prisma.Decimal(0);
        const attendanceCommission = affiliateAmounts.commissionAmount
          .minus(posCommission)
          .toDecimalPlaces(2);

        if (sale) {
          sale = await tx.pagoSuscripcion.update({
            where: { id: sale.id },
            data: {
              montoDescuentoAfiliado: posDiscount,
              baseComisionAfiliado: affiliate ? posTotal : 0,
              montoComisionAfiliado: posCommission,
              montoTotal: posTotal,
            },
            include: saleInclude,
          });
        }
        if (attendance) {
          attendance = await tx.suscripcionAsistencia.update({
            where: { id: attendance.id },
            data: {
              montoDescuentoAfiliado: attendanceDiscount,
              baseComisionAfiliado: affiliate ? attendanceTotal : 0,
              montoComisionAfiliado: attendanceCommission,
              montoTotal: attendanceTotal,
            },
            include: attendanceSubscriptionInclude,
          });
        }
        if (affiliate) {
          await this.affiliatesService.recordSale(tx, {
            companyId: company.id,
            paymentId: sale?.id,
            attendanceSubscriptionId: attendance?.id,
            context: affiliate,
            base: affiliateAmounts.total,
            commission: affiliateAmounts.commissionAmount,
            now,
            actorId,
          });
        }

        const receipt = await this.billingService.createReceiptForCheckout(tx, {
          requestId: dto.requestId,
          actorId,
          empresaId,
          type: dto.receiptType,
          total: affiliateAmounts.total,
          pagoSuscripcionId: sale?.id,
          suscripcionAsistenciaId: attendance?.id,
          items,
        });

        await tx.platformAuditLog.create({
          data: {
            empresaId,
            usuarioId: actorId,
            category: 'subscription',
            action: 'subscription_checkout_sold',
            source: 'admin',
            description: `Suscripcion registrada para ${company.nombreComercial}`,
            metadata: {
              posPaymentId: sale?.id.toString() ?? null,
              attendanceSubscriptionId: attendance?.id.toString() ?? null,
              affiliateDiscountAmount:
                affiliateAmounts.discountAmount.toFixed(2),
              affiliateCommissionAmount:
                affiliateAmounts.commissionAmount.toFixed(2),
              total: affiliateAmounts.total.toFixed(2),
              receiptId: receipt.id.toString(),
            },
          },
        });

        return { sale, attendance, receipt, idempotent: false };
      });

      return {
        sale: result.sale ? this.mapSale(result.sale) : null,
        attendance: result.attendance
          ? this.mapAttendanceSubscription(result.attendance, now)
          : null,
        receipt: result.receipt
          ? {
              id: result.receipt.id.toString(),
              type: result.receipt.tipo,
              correlativo: `${result.receipt.serie}-${String(result.receipt.numero).padStart(8, '0')}`,
              status: result.receipt.estado,
            }
          : null,
        idempotent: result.idempotent,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const [existingSale, existingAttendance] = await Promise.all([
          this.prisma.pagoSuscripcion.findUnique({
            where: { requestId: dto.requestId },
            include: saleInclude,
          }),
          this.prisma.suscripcionAsistencia.findUnique({
            where: { requestId: dto.requestId },
            include: attendanceSubscriptionInclude,
          }),
        ]);
        if (existingSale || existingAttendance) {
          return {
            sale: existingSale ? this.mapSale(existingSale) : null,
            attendance: existingAttendance
              ? this.mapAttendanceSubscription(existingAttendance, now)
              : null,
            receipt: null,
            idempotent: true,
          };
        }
      }
      throw error;
    }
  }

  async findAttendanceSubscriptions(
    query: FindAttendanceSubscriptionsQueryDto,
    now = new Date(),
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const where = this.buildAttendanceWhere(query);
    const monthStart = getLimaMonthStart(now);
    const [subscriptions, total, active, cancelledThisMonth, collected] =
      await Promise.all([
        this.prisma.suscripcionAsistencia.findMany({
          where,
          include: attendanceSubscriptionInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.suscripcionAsistencia.count({ where }),
        this.prisma.suscripcionAsistencia.count({
          where: {
            estado: SuscripcionAsistenciaEstado.activa,
            vigenciaFinAt: { gte: now },
          },
        }),
        this.prisma.suscripcionAsistencia.count({
          where: {
            estado: SuscripcionAsistenciaEstado.cancelada,
            anuladoAt: { gte: monthStart },
          },
        }),
        this.prisma.suscripcionAsistencia.aggregate({
          where: {
            estado: SuscripcionAsistenciaEstado.activa,
            createdAt: { gte: monthStart },
          },
          _sum: { montoTotal: true },
        }),
      ]);

    return {
      data: subscriptions.map((subscription) =>
        this.mapAttendanceSubscription(subscription, now),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      summary: {
        active,
        cancelledThisMonth,
        collectedThisMonth: (
          collected._sum.montoTotal ?? new Prisma.Decimal(0)
        ).toFixed(2),
      },
    };
  }

  async createAttendanceSubscription(
    actor: JwtPayload,
    dto: CreateAttendanceSubscriptionDto,
    now = new Date(),
  ) {
    const actorId = this.parseId(actor.sub, 'administrador');
    const empresaId = this.parseId(dto.empresaId, 'empresa');

    try {
      const result = await this.runSerializable(async (tx) => {
        const duplicate = await tx.suscripcionAsistencia.findUnique({
          where: { requestId: dto.requestId },
          include: attendanceSubscriptionInclude,
        });
        if (duplicate) return { subscription: duplicate, idempotent: true };

        await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${empresaId} FOR UPDATE`;
        const company = await tx.empresa.findUnique({
          where: { id: empresaId },
          select: {
            id: true,
            nombreComercial: true,
            estado: true,
            asistenciasActiva: true,
            asistenciasTrabajadoresLimite: true,
            asistenciasPuntosQrLimite: true,
            asistenciasInicioAt: true,
            asistenciasFinAt: true,
          },
        });
        if (!company) throw new NotFoundException('Empresa no encontrada');
        if (company.estado !== EmpresaEstado.activa) {
          throw new ConflictException({
            code: 'COMPANY_NOT_ACTIVE',
            message: 'La empresa debe estar activa para venderle Asistencias',
          });
        }

        const [pricing, activeEmployees, activeQrPoints] = await Promise.all([
          tx.tarifaAsistencia.findUnique({ where: { id: 1 } }),
          tx.empleado.count({ where: { empresaId, estado: 'activo' } }),
          tx.puntoQrAsistencia.count({
            where: { empresaId, estado: 'activo' },
          }),
        ]);
        if (!pricing) {
          throw new NotFoundException('Tarifa de Asistencias no configurada');
        }
        this.assertAttendanceCapacity(
          activeEmployees,
          activeQrPoints,
          dto.employeesLimit,
          dto.qrPointsLimit,
        );

        const coverageStartsAt = dto.startsAt ? new Date(dto.startsAt) : now;
        const months =
          dto.period === SuscripcionAsistenciaPeriodo.anual ? 12 : 1;
        const coverageEndsAt = addCalendarMonthsClamped(
          coverageStartsAt,
          months,
        );
        const monthlyAmount = pricing.precioTrabajador
          .mul(dto.employeesLimit)
          .plus(pricing.precioPuntoQr.mul(dto.qrPointsLimit))
          .toDecimalPlaces(2);
        const totalAmount = monthlyAmount.mul(months).toDecimalPlaces(2);

        await tx.empresa.update({
          where: { id: empresaId },
          data: {
            asistenciasActiva: true,
            asistenciasTrabajadoresLimite: BigInt(dto.employeesLimit),
            asistenciasPuntosQrLimite: BigInt(dto.qrPointsLimit),
            asistenciasInicioAt: coverageStartsAt,
            asistenciasFinAt: coverageEndsAt,
          },
        });

        const subscription = await tx.suscripcionAsistencia.create({
          data: {
            requestId: dto.requestId,
            empresaId,
            registradoPorId: actorId,
            trabajadoresLimite: BigInt(dto.employeesLimit),
            puntosQrLimite: BigInt(dto.qrPointsLimit),
            precioTrabajadorSnapshot: pricing.precioTrabajador,
            precioPuntoQrSnapshot: pricing.precioPuntoQr,
            periodo: dto.period,
            montoMensual: monthlyAmount,
            montoTotal: totalAmount,
            metodoPago: dto.paymentMethod,
            metodoPagoOtro:
              dto.paymentMethod === PagoSuscripcionMetodo.otro
                ? dto.paymentMethodOther
                : null,
            vigenciaInicioAt: coverageStartsAt,
            vigenciaFinAt: coverageEndsAt,
            limiteAnteriorTrabajadores: company.asistenciasTrabajadoresLimite,
            limiteAnteriorPuntosQr: company.asistenciasPuntosQrLimite,
            asistenciaAnteriorActiva: company.asistenciasActiva,
            asistenciaAnteriorInicioAt: company.asistenciasInicioAt,
            asistenciaAnteriorFinAt: company.asistenciasFinAt,
          },
          include: attendanceSubscriptionInclude,
        });

        await tx.platformAuditLog.create({
          data: {
            empresaId,
            usuarioId: actorId,
            category: 'subscription',
            action: 'attendance_subscription_sold',
            source: 'admin',
            description: `Suscripcion de Asistencias vendida a ${company.nombreComercial}`,
            metadata: {
              subscriptionId: subscription.id.toString(),
              period: dto.period,
              employeesLimit: dto.employeesLimit,
              qrPointsLimit: dto.qrPointsLimit,
              monthlyAmount: monthlyAmount.toFixed(2),
              totalAmount: totalAmount.toFixed(2),
              startsAt: coverageStartsAt.toISOString(),
              endsAt: coverageEndsAt.toISOString(),
            },
          },
        });

        return { subscription, idempotent: false };
      });

      return {
        subscription: this.mapAttendanceSubscription(result.subscription, now),
        idempotent: result.idempotent,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.suscripcionAsistencia.findUnique({
          where: { requestId: dto.requestId },
          include: attendanceSubscriptionInclude,
        });
        if (existing) {
          return {
            subscription: this.mapAttendanceSubscription(existing, now),
            idempotent: true,
          };
        }
      }
      throw error;
    }
  }

  async cancelAttendanceSubscription(
    actor: JwtPayload,
    id: string,
    dto: CancelSubscriptionSaleDto,
    now = new Date(),
  ) {
    const actorId = this.parseId(actor.sub, 'administrador');
    const subscriptionId = this.parseId(id, 'suscripcion');

    const subscription = await this.runSerializable(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "suscripcion_asistencia" WHERE "id" = ${subscriptionId} FOR UPDATE`;
      const current = await tx.suscripcionAsistencia.findUnique({
        where: { id: subscriptionId },
        include: attendanceSubscriptionInclude,
      });
      if (!current) {
        throw new NotFoundException('Suscripcion de Asistencias no encontrada');
      }
      if (current.estado === SuscripcionAsistenciaEstado.cancelada) {
        throw new ConflictException({
          code: 'ATTENDANCE_SUBSCRIPTION_ALREADY_CANCELLED',
          message: 'La suscripcion ya fue anulada',
        });
      }

      await tx.$queryRaw`SELECT "id" FROM "empresa" WHERE "id" = ${current.empresaId} FOR UPDATE`;
      const latest = await tx.suscripcionAsistencia.findFirst({
        where: {
          empresaId: current.empresaId,
          estado: SuscripcionAsistenciaEstado.activa,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (latest?.id !== current.id) {
        throw new ConflictException({
          code: 'ATTENDANCE_SUBSCRIPTION_NOT_CURRENT',
          message:
            'La suscripcion no puede revertirse porque existe un cambio posterior',
        });
      }

      await tx.empresa.update({
        where: { id: current.empresaId },
        data: {
          asistenciasActiva: current.asistenciaAnteriorActiva,
          asistenciasTrabajadoresLimite: current.limiteAnteriorTrabajadores,
          asistenciasPuntosQrLimite: current.limiteAnteriorPuntosQr,
          asistenciasInicioAt: current.asistenciaAnteriorInicioAt,
          asistenciasFinAt: current.asistenciaAnteriorFinAt,
        },
      });
      const updated = await tx.suscripcionAsistencia.update({
        where: { id: current.id },
        data: {
          estado: SuscripcionAsistenciaEstado.cancelada,
          motivoAnulacion: dto.reason,
          anuladoAt: now,
          anuladoPorId: actorId,
        },
        include: attendanceSubscriptionInclude,
      });
      await this.affiliatesService.cancelAttendanceCommission(
        tx,
        current.id,
        current.empresaId,
        now,
      );
      await tx.platformAuditLog.create({
        data: {
          empresaId: current.empresaId,
          usuarioId: actorId,
          category: 'subscription',
          action: 'attendance_subscription_cancelled',
          source: 'admin',
          description: `Suscripcion de Asistencias anulada para ${current.empresa.nombreComercial}`,
          metadata: {
            subscriptionId: current.id.toString(),
            reason: dto.reason,
          },
        },
      });
      return updated;
    });

    return this.mapAttendanceSubscription(subscription, now);
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

  private buildAttendanceWhere(
    query: FindAttendanceSubscriptionsQueryDto,
  ): Prisma.SuscripcionAsistenciaWhereInput {
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
    if (to) to.setUTCDate(to.getUTCDate() + 1);

    return {
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

  private mapAttendanceSubscription(
    subscription: AttendanceSubscription,
    now = new Date(),
  ) {
    const mapUser = (user: AttendanceSubscription['registradoPor'] | null) =>
      user
        ? {
            id: user.id.toString(),
            name: [user.nombre, user.apellido].filter(Boolean).join(' '),
            email: user.email,
          }
        : null;
    const expired =
      subscription.estado === SuscripcionAsistenciaEstado.activa &&
      subscription.vigenciaFinAt < now;

    return {
      id: subscription.id.toString(),
      requestId: subscription.requestId,
      company: {
        id: subscription.empresa.id.toString(),
        name: subscription.empresa.nombreComercial,
        document: subscription.empresa.ruc ?? subscription.empresa.dni,
      },
      employeesLimit: Number(subscription.trabajadoresLimite),
      qrPointsLimit: Number(subscription.puntosQrLimite),
      employeeUnitPrice: subscription.precioTrabajadorSnapshot.toFixed(2),
      qrPointUnitPrice: subscription.precioPuntoQrSnapshot.toFixed(2),
      period: subscription.periodo,
      monthlyAmount: subscription.montoMensual.toFixed(2),
      totalAmount: subscription.montoTotal.toFixed(2),
      affiliateCode: subscription.afiliadoCodigo,
      affiliateDiscountPercent:
        subscription.descuentoAfiliadoPorcentaje.toFixed(2),
      affiliateDiscountAmount: subscription.montoDescuentoAfiliado.toFixed(2),
      affiliateCommissionBase: subscription.baseComisionAfiliado.toFixed(2),
      affiliateCommissionPercent:
        subscription.comisionAfiliadoPorcentaje.toFixed(2),
      affiliateCommissionAmount: subscription.montoComisionAfiliado.toFixed(2),
      currency: subscription.moneda,
      includesIgv: subscription.incluyeIgv,
      paymentMethod: subscription.metodoPago,
      paymentMethodOther: subscription.metodoPagoOtro,
      status: expired ? 'vencida' : subscription.estado,
      coverageStartsAt: subscription.vigenciaInicioAt.toISOString(),
      coverageEndsAt: subscription.vigenciaFinAt.toISOString(),
      usage: {
        employees: subscription.empresa._count.empleados,
        qrPoints: subscription.empresa._count.puntosQrAsistencia,
      },
      registeredBy: mapUser(subscription.registradoPor),
      cancelledBy: mapUser(subscription.anuladoPor),
      cancellationReason: subscription.motivoAnulacion,
      cancelledAt: subscription.anuladoAt?.toISOString() ?? null,
      createdAt: subscription.createdAt.toISOString(),
    };
  }

  private assertAttendanceCapacity(
    activeEmployees: number,
    activeQrPoints: number,
    employeesLimit: number,
    qrPointsLimit: number,
  ) {
    if (activeEmployees > employeesLimit) {
      throw new ConflictException({
        code: 'ATTENDANCE_EMPLOYEE_LIMIT_BELOW_USAGE',
        message:
          'El limite de trabajadores no puede ser menor al consumo actual',
        used: activeEmployees,
        limit: employeesLimit,
      });
    }
    if (activeQrPoints > qrPointsLimit) {
      throw new ConflictException({
        code: 'ATTENDANCE_QR_LIMIT_BELOW_USAGE',
        message: 'El limite de puntos QR no puede ser menor al consumo actual',
        used: activeQrPoints,
        limit: qrPointsLimit,
      });
    }
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

function sumItems(items: Array<{ total: Prisma.Decimal }>) {
  return items.reduce(
    (sum, item) => sum.plus(item.total),
    new Prisma.Decimal(0),
  );
}

function proportionalAmount(
  amount: Prisma.Decimal,
  part: Prisma.Decimal,
  total: Prisma.Decimal,
) {
  if (amount.lte(0) || part.lte(0) || total.lte(0)) {
    return new Prisma.Decimal(0);
  }
  return amount.mul(part).div(total).toDecimalPlaces(2);
}

function applyDiscount(
  items: Array<{ total: Prisma.Decimal }>,
  discount: Prisma.Decimal,
) {
  if (!items.length || discount.lte(0)) return;
  const base = sumItems(items);
  let assigned = new Prisma.Decimal(0);
  items.forEach((item, index) => {
    const share =
      index === items.length - 1
        ? discount.minus(assigned).toDecimalPlaces(2)
        : proportionalAmount(discount, item.total, base);
    assigned = assigned.plus(share);
    item.total = item.total.minus(share).toDecimalPlaces(2);
  });
}

export function isSerializationConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      (error.code === 'P2010' && error.meta?.code === '40001'))
  );
}
