import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AfiliadoEstado,
  ComisionAfiliadoEstado,
  ComisionAfiliadoTipo,
  EmpresaAfiliacionEstado,
  LiquidacionAfiliadoEstado,
  Prisma,
} from '@prisma/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import {
  CloseAffiliateSettlementDto,
  FindAffiliateCommissionsQueryDto,
  FindAffiliateCompaniesQueryDto,
  FindAffiliatesQueryDto,
  PayAffiliateSettlementDto,
  SaveAffiliateDto,
  ValidateAffiliateCodeQueryDto,
} from './dto/platform-affiliates.dto';

type AffiliateSaleContext = {
  id: bigint;
  code: string;
  discountPercent: Prisma.Decimal;
  commissionPercent: Prisma.Decimal;
  isNew: boolean;
};

@Injectable()
export class PlatformAffiliatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FindAffiliatesQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.AfiliadoWhereInput = {
      ...(query.status ? { estado: query.status } : {}),
      ...(search
        ? {
            OR: [
              { codigo: { contains: search, mode: 'insensitive' } },
              { nombre: { contains: search, mode: 'insensitive' } },
              { documento: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total, active, commission] = await Promise.all([
      this.prisma.afiliado.findMany({
        where,
        include: {
          _count: { select: { afiliaciones: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.afiliado.count({ where }),
      this.prisma.afiliado.count({ where: { estado: AfiliadoEstado.activo } }),
      this.prisma.comisionAfiliado.aggregate({
        where: { estado: ComisionAfiliadoEstado.pendiente },
        _sum: { monto: true },
      }),
    ]);
    const generated = await this.prisma.comisionAfiliado.groupBy({
      by: ['afiliadoId'],
      where: {
        afiliadoId: { in: rows.map((row) => row.id) },
        estado: { not: ComisionAfiliadoEstado.anulada },
      },
      _sum: { monto: true },
    });
    const generatedByAffiliate = new Map(
      generated.map((item) => [item.afiliadoId, item._sum.monto]),
    );
    return {
      data: rows.map((row) => ({
        id: row.id.toString(),
        code: row.codigo,
        name: row.nombre,
        document: row.documento,
        email: row.email,
        phone: row.telefono,
        discountPercent: row.descuentoPorcentaje.toFixed(2),
        commissionPercent: row.comisionPorcentaje.toFixed(2),
        status: row.estado,
        companies: row._count.afiliaciones,
        generatedCommission: (
          generatedByAffiliate.get(row.id) ?? new Prisma.Decimal(0)
        ).toFixed(2),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      meta: this.meta(query.page, query.limit, total),
      summary: {
        total: await this.prisma.afiliado.count(),
        active,
        pendingCommission: (
          commission._sum.monto ?? new Prisma.Decimal(0)
        ).toFixed(2),
      },
    };
  }

  async findOne(id: string) {
    const affiliate = await this.prisma.afiliado.findUnique({
      where: { id: this.parseId(id, 'afiliado') },
    });
    if (!affiliate) throw new NotFoundException('Afiliado no encontrado');
    return {
      id: affiliate.id.toString(),
      code: affiliate.codigo,
      name: affiliate.nombre,
      document: affiliate.documento,
      email: affiliate.email,
      phone: affiliate.telefono,
      discountPercent: affiliate.descuentoPorcentaje.toFixed(2),
      commissionPercent: affiliate.comisionPorcentaje.toFixed(2),
      status: affiliate.estado,
      createdAt: affiliate.createdAt.toISOString(),
      updatedAt: affiliate.updatedAt.toISOString(),
    };
  }

  create(actor: JwtPayload, dto: SaveAffiliateDto) {
    return this.save(actor, null, dto);
  }

  update(actor: JwtPayload, id: string, dto: SaveAffiliateDto) {
    return this.save(actor, this.parseId(id, 'afiliado'), dto);
  }

  private async save(
    actor: JwtPayload,
    id: bigint | null,
    dto: SaveAffiliateDto,
  ) {
    const actorId = this.parseId(actor.sub, 'administrador');
    const code = dto.code.toUpperCase();
    const discount = this.percent(dto.discountPercent, 'descuento');
    const commission = this.percent(dto.commissionPercent, 'comision');
    try {
      const affiliate = await this.prisma.$transaction(async (tx) => {
        if (id) {
          const current = await tx.afiliado.findUnique({
            where: { id },
            include: { _count: { select: { afiliaciones: true } } },
          });
          if (!current) throw new NotFoundException('Afiliado no encontrado');
          if (current.codigoKey !== code && current._count.afiliaciones > 0) {
            throw new ConflictException({
              code: 'AFFILIATE_CODE_ALREADY_USED',
              message: 'El codigo no puede cambiar porque ya tiene empresas',
            });
          }
        }
        const saved = id
          ? await tx.afiliado.update({
              where: { id },
              data: this.affiliateData(
                dto,
                code,
                discount,
                commission,
                actorId,
              ),
            })
          : await tx.afiliado.create({
              data: {
                ...this.affiliateData(dto, code, discount, commission, actorId),
                creadoPorId: actorId,
              },
            });
        await tx.platformAuditLog.create({
          data: {
            usuarioId: actorId,
            category: 'affiliate',
            action: id ? 'affiliate_updated' : 'affiliate_created',
            source: 'admin',
            description: `${id ? 'Afiliado actualizado' : 'Afiliado creado'}: ${saved.codigo}`,
            metadata: {
              affiliateId: saved.id.toString(),
              code: saved.codigo,
              discountPercent: saved.descuentoPorcentaje.toFixed(2),
              commissionPercent: saved.comisionPorcentaje.toFixed(2),
              status: saved.estado,
            },
          },
        });
        return saved;
      });
      return this.findOne(affiliate.id.toString());
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'AFFILIATE_CODE_DUPLICATE',
          message: 'El codigo de afiliado ya existe',
        });
      }
      throw error;
    }
  }

  async validateCode(query: ValidateAffiliateCodeQueryDto, now = new Date()) {
    const companyId = this.parseId(query.companyId, 'empresa');
    const company = await this.prisma.empresa.findUnique({
      where: { id: companyId },
      select: { id: true, planFinAt: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const context = await this.resolveSaleContext(
      this.prisma,
      company,
      query.code,
      now,
      false,
    );
    if (!context) throw this.invalidCode();
    return {
      id: context.id.toString(),
      code: context.code,
      discountPercent: context.discountPercent.toFixed(2),
      commissionPercent: context.commissionPercent.toFixed(2),
      appliesDiscount: context.isNew,
    };
  }

  async validatePublicCode(code: string | undefined) {
    const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const empty = {
      valid: false as const,
      code: normalized,
      discountPercent: '0.00',
      reason: 'invalid' as const,
    };

    if (!/^[A-Z0-9-]{4,30}$/.test(normalized)) {
      return empty;
    }

    const affiliate = await this.prisma.afiliado.findUnique({
      where: { codigoKey: normalized },
      select: {
        codigo: true,
        descuentoPorcentaje: true,
        estado: true,
      },
    });

    if (!affiliate) {
      return empty;
    }

    if (affiliate.estado !== AfiliadoEstado.activo) {
      return {
        valid: false as const,
        code: affiliate.codigo,
        discountPercent: '0.00',
        reason: 'inactive' as const,
      };
    }

    return {
      valid: true as const,
      code: affiliate.codigo,
      discountPercent: affiliate.descuentoPorcentaje.toFixed(2),
      currency: 'PEN' as const,
    };
  }

  async resolveSaleContext(
    tx: Prisma.TransactionClient | PrismaService,
    company: { id: bigint; planFinAt: Date | null },
    requestedCode: string | undefined,
    now: Date,
    persistInterruption = true,
    actorId?: bigint,
  ): Promise<AffiliateSaleContext | null> {
    const [affiliation, paidSales] = await Promise.all([
      tx.empresaAfiliacion.findUnique({
        where: { empresaId: company.id },
        include: { afiliado: true },
      }),
      tx.pagoSuscripcion.count({
        where: { empresaId: company.id, estado: 'pagado' },
      }),
    ]);

    if (affiliation?.estado === EmpresaAfiliacionEstado.activa) {
      if (company.planFinAt && company.planFinAt.getTime() <= now.getTime()) {
        if (persistInterruption) {
          await tx.empresaAfiliacion.update({
            where: { empresaId: company.id },
            data: {
              estado: EmpresaAfiliacionEstado.interrumpida,
              interrumpidaAt: now,
              motivoFin: 'El plan vencio antes de la renovacion',
            },
          });
          await tx.platformAuditLog.create({
            data: {
              empresaId: company.id,
              usuarioId: actorId,
              category: 'affiliate',
              action: 'affiliate_interrupted',
              source: 'admin',
              description: `Afiliacion ${affiliation.afiliado.codigo} interrumpida por vencimiento`,
              metadata: {
                affiliateId: affiliation.afiliado.id.toString(),
                code: affiliation.afiliado.codigo,
              },
            },
          });
        }
        if (requestedCode) {
          throw new ConflictException({
            code: 'AFFILIATION_INTERRUPTED',
            message: 'La afiliacion termino al vencer el plan',
          });
        }
        return null;
      }
      if (
        requestedCode &&
        requestedCode.toUpperCase() !== affiliation.afiliado.codigoKey
      ) {
        throw new ConflictException({
          code: 'COMPANY_NOT_AFFILIATE_ELIGIBLE',
          message: 'La empresa ya tiene un codigo de afiliado',
        });
      }
      return {
        id: affiliation.afiliado.id,
        code: affiliation.afiliado.codigo,
        discountPercent: new Prisma.Decimal(0),
        commissionPercent: affiliation.afiliado.comisionPorcentaje,
        isNew: false,
      };
    }

    if (
      paidSales > 0 ||
      affiliation?.estado === EmpresaAfiliacionEstado.interrumpida
    ) {
      if (requestedCode) {
        throw new ConflictException({
          code:
            affiliation?.estado === EmpresaAfiliacionEstado.interrumpida
              ? 'AFFILIATION_INTERRUPTED'
              : 'COMPANY_NOT_AFFILIATE_ELIGIBLE',
          message: 'La empresa ya no puede aplicar un codigo de afiliado',
        });
      }
      return null;
    }
    if (!requestedCode) return null;

    const affiliate = await tx.afiliado.findUnique({
      where: { codigoKey: requestedCode.toUpperCase() },
    });
    if (!affiliate) throw this.invalidCode();
    if (affiliate.estado !== AfiliadoEstado.activo) {
      throw new ConflictException({
        code: 'AFFILIATE_CODE_INACTIVE',
        message: 'El codigo de afiliado esta inactivo',
      });
    }
    return {
      id: affiliate.id,
      code: affiliate.codigo,
      discountPercent: affiliate.descuentoPorcentaje,
      commissionPercent: affiliate.comisionPorcentaje,
      isNew: true,
    };
  }

  async recordSale(
    tx: Prisma.TransactionClient,
    params: {
      companyId: bigint;
      paymentId: bigint;
      context: AffiliateSaleContext;
      base: Prisma.Decimal;
      commission: Prisma.Decimal;
      now: Date;
      actorId: bigint;
    },
  ) {
    if (params.context.isNew) {
      await tx.empresaAfiliacion.upsert({
        where: { empresaId: params.companyId },
        create: {
          empresaId: params.companyId,
          afiliadoId: params.context.id,
          primerPagoId: params.paymentId,
          iniciadaAt: params.now,
        },
        update: {
          afiliadoId: params.context.id,
          primerPagoId: params.paymentId,
          estado: EmpresaAfiliacionEstado.activa,
          iniciadaAt: params.now,
          interrumpidaAt: null,
          motivoFin: null,
        },
      });
      await tx.platformAuditLog.create({
        data: {
          empresaId: params.companyId,
          usuarioId: params.actorId,
          category: 'affiliate',
          action: 'company_affiliated',
          source: 'admin',
          description: `Empresa afiliada con el codigo ${params.context.code}`,
          metadata: {
            affiliateId: params.context.id.toString(),
            paymentId: params.paymentId.toString(),
            code: params.context.code,
          },
        },
      });
    }
    await tx.comisionAfiliado.create({
      data: {
        afiliadoId: params.context.id,
        empresaId: params.companyId,
        pagoSuscripcionId: params.paymentId,
        periodo: getLimaPeriod(params.now),
        baseCalculo: params.base,
        porcentaje: params.context.commissionPercent,
        monto: params.commission,
      },
    });
  }

  async cancelSaleCommission(
    tx: Prisma.TransactionClient,
    paymentId: bigint,
    companyId: bigint,
    now: Date,
  ) {
    const commission = await tx.comisionAfiliado.findUnique({
      where: {
        pagoSuscripcionId_tipo: {
          pagoSuscripcionId: paymentId,
          tipo: ComisionAfiliadoTipo.venta,
        },
      },
      include: { liquidacion: true },
    });
    if (commission && commission.estado === ComisionAfiliadoEstado.pendiente) {
      await tx.comisionAfiliado.update({
        where: { id: commission.id },
        data: { estado: ComisionAfiliadoEstado.anulada },
      });
    } else if (
      commission?.liquidacion?.estado === LiquidacionAfiliadoEstado.pendiente
    ) {
      await tx.comisionAfiliado.update({
        where: { id: commission.id },
        data: { estado: ComisionAfiliadoEstado.anulada },
      });
      await tx.liquidacionAfiliado.update({
        where: { id: commission.liquidacion.id },
        data: {
          cantidad: { decrement: 1 },
          montoTotal: { decrement: commission.monto },
        },
      });
    } else if (
      commission?.liquidacion?.estado === LiquidacionAfiliadoEstado.pagada
    ) {
      await tx.comisionAfiliado.create({
        data: {
          afiliadoId: commission.afiliadoId,
          empresaId: companyId,
          pagoSuscripcionId: paymentId,
          tipo: ComisionAfiliadoTipo.ajuste_anulacion,
          periodo: getLimaPeriod(now),
          baseCalculo: commission.baseCalculo,
          porcentaje: commission.porcentaje,
          monto: commission.monto.negated(),
        },
      });
    }

    const affiliation = await tx.empresaAfiliacion.findUnique({
      where: { empresaId: companyId },
    });
    if (affiliation?.primerPagoId === paymentId) {
      const remaining = await tx.pagoSuscripcion.count({
        where: {
          empresaId: companyId,
          estado: 'pagado',
          id: { not: paymentId },
        },
      });
      if (remaining === 0) {
        await tx.empresaAfiliacion.update({
          where: { empresaId: companyId },
          data: {
            estado: EmpresaAfiliacionEstado.cancelada,
            interrumpidaAt: now,
            motivoFin: 'La primera compra fue anulada',
          },
        });
      }
    }
  }

  async findCompanies(query: FindAffiliateCompaniesQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.EmpresaAfiliacionWhereInput = {
      ...(query.affiliateId
        ? { afiliadoId: this.parseId(query.affiliateId, 'afiliado') }
        : {}),
      ...(search
        ? {
            OR: [
              {
                empresa: {
                  nombreComercial: { contains: search, mode: 'insensitive' },
                },
              },
              {
                afiliado: { codigo: { contains: search, mode: 'insensitive' } },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.empresaAfiliacion.findMany({
        where,
        include: {
          empresa: {
            select: {
              id: true,
              nombreComercial: true,
              planCodigo: true,
              planFinAt: true,
            },
          },
          afiliado: { select: { id: true, codigo: true, nombre: true } },
          primerPago: { select: { createdAt: true } },
        },
        orderBy: { iniciadaAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.empresaAfiliacion.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        company: {
          id: row.empresa.id.toString(),
          name: row.empresa.nombreComercial,
        },
        affiliate: {
          id: row.afiliado.id.toString(),
          code: row.afiliado.codigo,
          name: row.afiliado.nombre,
        },
        status:
          row.estado === EmpresaAfiliacionEstado.activa &&
          row.empresa.planFinAt &&
          row.empresa.planFinAt <= new Date()
            ? EmpresaAfiliacionEstado.interrumpida
            : row.estado,
        planCode: row.empresa.planCodigo,
        planEndsAt: row.empresa.planFinAt?.toISOString() ?? null,
        startedAt: row.iniciadaAt.toISOString(),
        endedAt: row.interrumpidaAt?.toISOString() ?? null,
        reason: row.motivoFin,
      })),
      meta: this.meta(query.page, query.limit, total),
    };
  }

  async findCommissions(query: FindAffiliateCommissionsQueryDto) {
    const where: Prisma.ComisionAfiliadoWhereInput = {
      ...(query.affiliateId
        ? { afiliadoId: this.parseId(query.affiliateId, 'afiliado') }
        : {}),
      ...(query.period ? { periodo: query.period } : {}),
      ...(query.search
        ? {
            OR: [
              {
                afiliado: {
                  codigo: { contains: query.search, mode: 'insensitive' },
                },
              },
              {
                empresa: {
                  nombreComercial: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total, summary] = await Promise.all([
      this.prisma.comisionAfiliado.findMany({
        where,
        include: {
          afiliado: { select: { id: true, codigo: true, nombre: true } },
          empresa: { select: { id: true, nombreComercial: true } },
          liquidacion: { select: { id: true, estado: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.comisionAfiliado.count({ where }),
      this.prisma.comisionAfiliado.groupBy({
        by: ['estado'],
        where,
        _sum: { monto: true },
      }),
    ]);
    const amount = (state: ComisionAfiliadoEstado) =>
      (
        summary.find((item) => item.estado === state)?._sum.monto ??
        new Prisma.Decimal(0)
      ).toFixed(2);
    return {
      data: rows.map((row) => ({
        id: row.id.toString(),
        affiliate: {
          id: row.afiliado.id.toString(),
          code: row.afiliado.codigo,
          name: row.afiliado.nombre,
        },
        company: {
          id: row.empresa.id.toString(),
          name: row.empresa.nombreComercial,
        },
        period: row.periodo,
        type: row.tipo,
        baseAmount: row.baseCalculo.toFixed(2),
        percent: row.porcentaje.toFixed(2),
        amount: row.monto.toFixed(2),
        status: row.estado,
        settlementId: row.liquidacion?.id.toString() ?? null,
        settlementStatus: row.liquidacion?.estado ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      meta: this.meta(query.page, query.limit, total),
      summary: {
        pending: amount(ComisionAfiliadoEstado.pendiente),
        liquidated: amount(ComisionAfiliadoEstado.liquidada),
      },
    };
  }

  async findSettlements(query: FindAffiliateCommissionsQueryDto) {
    const where: Prisma.LiquidacionAfiliadoWhereInput = {
      ...(query.affiliateId
        ? { afiliadoId: this.parseId(query.affiliateId, 'afiliado') }
        : {}),
      ...(query.period ? { periodo: query.period } : {}),
      ...(query.search
        ? {
            afiliado: {
              OR: [
                { codigo: { contains: query.search, mode: 'insensitive' } },
                { nombre: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.liquidacionAfiliado.findMany({
        where,
        include: { afiliado: true, cerradaPor: true, pagadaPor: true },
        orderBy: [{ periodo: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.liquidacionAfiliado.count({ where }),
    ]);
    return {
      data: rows.map((row) => this.mapSettlement(row)),
      meta: this.meta(query.page, query.limit, total),
    };
  }

  closeSettlement(
    actor: JwtPayload,
    dto: CloseAffiliateSettlementDto,
    now = new Date(),
  ) {
    if (dto.period >= getLimaPeriod(now)) {
      throw new BadRequestException('Solo puedes cerrar meses terminados');
    }
    const actorId = this.parseId(actor.sub, 'administrador');
    const affiliateId = this.parseId(dto.affiliateId, 'afiliado');
    return this.runSerializable(async (tx) => {
      const duplicate = await tx.liquidacionAfiliado.findUnique({
        where: { requestId: dto.requestId },
        include: this.settlementInclude(),
      });
      if (duplicate) return this.mapSettlement(duplicate);
      await tx.$queryRaw`SELECT "id" FROM "afiliado" WHERE "id" = ${affiliateId} FOR UPDATE`;
      const affiliate = await tx.afiliado.findUnique({
        where: { id: affiliateId },
      });
      if (!affiliate) throw new NotFoundException('Afiliado no encontrado');
      const movements = await tx.comisionAfiliado.findMany({
        where: {
          afiliadoId: affiliateId,
          estado: ComisionAfiliadoEstado.pendiente,
          periodo: { lte: dto.period },
        },
        select: { id: true, monto: true },
      });
      if (!movements.length)
        throw new BadRequestException(
          'No hay comisiones pendientes para cerrar',
        );
      const total = movements.reduce(
        (sum, item) => sum.plus(item.monto),
        new Prisma.Decimal(0),
      );
      const settlement = await tx.liquidacionAfiliado.create({
        data: {
          requestId: dto.requestId,
          afiliadoId: affiliateId,
          periodo: dto.period,
          cantidad: movements.length,
          montoTotal: total,
          cerradaPorId: actorId,
        },
      });
      await tx.comisionAfiliado.updateMany({
        where: { id: { in: movements.map((item) => item.id) } },
        data: {
          estado: ComisionAfiliadoEstado.liquidada,
          liquidacionId: settlement.id,
        },
      });
      await tx.platformAuditLog.create({
        data: {
          usuarioId: actorId,
          category: 'affiliate',
          action: 'affiliate_settlement_closed',
          source: 'admin',
          description: `Liquidacion ${dto.period} cerrada para ${affiliate.codigo}`,
          metadata: {
            affiliateId: affiliate.id.toString(),
            period: dto.period,
            amount: total.toFixed(2),
          },
        },
      });
      return this.mapSettlement(
        await tx.liquidacionAfiliado.findUniqueOrThrow({
          where: { id: settlement.id },
          include: this.settlementInclude(),
        }),
      );
    });
  }

  paySettlement(
    actor: JwtPayload,
    id: string,
    dto: PayAffiliateSettlementDto,
    now = new Date(),
  ) {
    const actorId = this.parseId(actor.sub, 'administrador');
    const settlementId = this.parseId(id, 'liquidacion');
    return this.runSerializable(async (tx) => {
      const duplicate = await tx.liquidacionAfiliado.findUnique({
        where: { pagoRequestId: dto.requestId },
        include: this.settlementInclude(),
      });
      if (duplicate) return this.mapSettlement(duplicate);
      await tx.$queryRaw`SELECT "id" FROM "liquidacion_afiliado" WHERE "id" = ${settlementId} FOR UPDATE`;
      const current = await tx.liquidacionAfiliado.findUnique({
        where: { id: settlementId },
        include: { afiliado: true },
      });
      if (!current) throw new NotFoundException('Liquidacion no encontrada');
      if (current.estado === LiquidacionAfiliadoEstado.pagada)
        throw new ConflictException({
          code: 'AFFILIATE_SETTLEMENT_ALREADY_PAID',
          message: 'La liquidacion ya fue pagada',
        });
      if (current.montoTotal.lte(0))
        throw new ConflictException(
          'La liquidacion no tiene saldo positivo para pagar',
        );
      const updated = await tx.liquidacionAfiliado.update({
        where: { id: settlementId },
        data: {
          estado: LiquidacionAfiliadoEstado.pagada,
          pagoRequestId: dto.requestId,
          metodoPago: dto.paymentMethod,
          referenciaPago: dto.reference,
          pagadaPorId: actorId,
          pagadoAt: now,
        },
        include: this.settlementInclude(),
      });
      await tx.platformAuditLog.create({
        data: {
          usuarioId: actorId,
          category: 'affiliate',
          action: 'affiliate_settlement_paid',
          source: 'admin',
          description: `Liquidacion ${current.periodo} pagada a ${current.afiliado.codigo}`,
          metadata: {
            settlementId: current.id.toString(),
            amount: current.montoTotal.toFixed(2),
            paymentMethod: dto.paymentMethod,
            reference: dto.reference,
          },
        },
      });
      return this.mapSettlement(updated);
    });
  }

  async generateSettlementPdf(id: string) {
    const settlement = await this.prisma.liquidacionAfiliado.findUnique({
      where: { id: this.parseId(id, 'liquidacion') },
      include: {
        afiliado: true,
        comisiones: {
          include: {
            empresa: {
              select: {
                nombreComercial: true,
                razonSocial: true,
                ruc: true,
                dni: true,
              },
            },
            pagoSuscripcion: {
              select: {
                planCodigo: true,
                meses: true,
                createdAt: true,
              },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!settlement) throw new NotFoundException('Liquidacion no encontrada');

    const buffer = await this.createSettlementPdf((doc) => {
      const fonts = this.pdfFonts(doc);
      const money = (value: Prisma.Decimal) =>
        `S/ ${value.toNumber().toLocaleString('es-PE', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      const left = 42;
      const width = doc.page.width - 84;

      const pageHeader = () => {
        doc.rect(0, 0, doc.page.width, 92).fill('#13257a');
        const logo = resolve(
          process.cwd(),
          '..',
          '..',
          'nobitex',
          'public',
          'Logo',
          'Norvitex.png',
        );
        if (existsSync(logo)) doc.image(logo, left, 22, { fit: [40, 40] });
        doc
          .fillColor('#ffffff')
          .font(fonts.bold)
          .fontSize(18)
          .text('NORBITEX', 92, 25)
          .font(fonts.regular)
          .fontSize(9)
          .fillColor('#d8defc')
          .text('Guia mensual de pago de afiliado', 92, 50);
        doc
          .roundedRect(doc.page.width - 135, 27, 93, 30, 6)
          .fill(settlement.estado === 'pagada' ? '#10b981' : '#f59e0b')
          .fillColor('#ffffff')
          .font(fonts.bold)
          .fontSize(9)
          .text(
            settlement.estado === 'pagada' ? 'PAGADA' : 'PENDIENTE',
            doc.page.width - 135,
            38,
            { width: 93, align: 'center' },
          );
      };
      const tableHeader = (y: number) => {
        doc.roundedRect(left, y, width, 25, 5).fill('#eef1fa');
        doc.fillColor('#13257a').font(fonts.bold).fontSize(7.5);
        doc.text('EMPRESA / FECHA', left + 8, y + 9, { width: 180 });
        doc.text('PLAN', left + 190, y + 9, { width: 75 });
        doc.text('COBRADO', left + 270, y + 9, {
          width: 75,
          align: 'right',
        });
        doc.text('%', left + 350, y + 9, { width: 40, align: 'right' });
        doc.text('COMISION', left + 395, y + 9, {
          width: width - 403,
          align: 'right',
        });
        return y + 25;
      };

      pageHeader();
      doc
        .fillColor('#111827')
        .font(fonts.bold)
        .fontSize(15)
        .text(settlement.afiliado.nombre, left, 116)
        .font(fonts.regular)
        .fontSize(9)
        .fillColor('#64748b')
        .text(
          `Codigo: ${settlement.afiliado.codigo}   |   Periodo: ${settlement.periodo}`,
          left,
          139,
        );
      const contact = [
        settlement.afiliado.documento,
        settlement.afiliado.email,
        settlement.afiliado.telefono,
      ]
        .filter(Boolean)
        .join('   |   ');
      if (contact) doc.text(contact, left, 154);

      const baseTotal = settlement.comisiones.reduce(
        (sum, item) => sum.plus(item.baseCalculo),
        new Prisma.Decimal(0),
      );
      const summaryY = 181;
      const cardWidth = (width - 20) / 3;
      [
        ['Pagos incluidos', String(settlement.cantidad)],
        ['Base neta cobrada', money(baseTotal)],
        ['Total a pagar', money(settlement.montoTotal)],
      ].forEach(([label, value], index) => {
        const x = left + index * (cardWidth + 10);
        doc
          .roundedRect(x, summaryY, cardWidth, 62, 8)
          .fill(index === 2 ? '#13257a' : '#f6f7fb');
        doc
          .fillColor(index === 2 ? '#cbd5ff' : '#64748b')
          .font(fonts.regular)
          .fontSize(8)
          .text(label, x + 12, summaryY + 13);
        doc
          .fillColor(index === 2 ? '#ffffff' : '#111827')
          .font(fonts.bold)
          .fontSize(13)
          .text(value, x + 12, summaryY + 33, { width: cardWidth - 24 });
      });

      let y = tableHeader(266);
      settlement.comisiones.forEach((item) => {
        if (y > 742) {
          doc.addPage();
          pageHeader();
          y = tableHeader(115);
        }
        const company =
          item.empresa.razonSocial || item.empresa.nombreComercial;
        const document =
          item.empresa.ruc || item.empresa.dni || 'Sin documento';
        const date = item.pagoSuscripcion.createdAt.toLocaleDateString(
          'es-PE',
          { timeZone: 'America/Lima' },
        );
        doc
          .fillColor('#111827')
          .font(fonts.bold)
          .fontSize(8)
          .text(company, left + 8, y + 8, {
            width: 174,
            ellipsis: true,
          });
        doc
          .fillColor('#64748b')
          .font(fonts.regular)
          .fontSize(7)
          .text(`${document} | ${date}`, left + 8, y + 22, {
            width: 174,
            ellipsis: true,
          });
        doc
          .fillColor('#111827')
          .font(fonts.regular)
          .fontSize(8)
          .text(
            `${item.pagoSuscripcion.planCodigo} (${item.pagoSuscripcion.meses} mes${item.pagoSuscripcion.meses === 1 ? '' : 'es'})`,
            left + 190,
            y + 13,
            { width: 75 },
          );
        doc.text(money(item.baseCalculo), left + 270, y + 13, {
          width: 75,
          align: 'right',
        });
        doc.text(`${item.porcentaje.toFixed(2)}%`, left + 350, y + 13, {
          width: 40,
          align: 'right',
        });
        doc
          .fillColor(item.monto.isNegative() ? '#dc2626' : '#13257a')
          .font(fonts.bold)
          .text(money(item.monto), left + 395, y + 13, {
            width: width - 403,
            align: 'right',
          });
        doc
          .moveTo(left, y + 40)
          .lineTo(left + width, y + 40)
          .strokeColor('#e5e7eb')
          .lineWidth(0.6)
          .stroke();
        y += 41;
      });

      if (y > 690) {
        doc.addPage();
        pageHeader();
        y = 120;
      }
      doc.roundedRect(left, y + 18, width, 74, 8).fill('#f6f7fb');
      doc
        .fillColor('#64748b')
        .font(fonts.regular)
        .fontSize(8)
        .text('RESUMEN DE PAGO', left + 14, y + 31);
      doc
        .fillColor('#111827')
        .font(fonts.bold)
        .fontSize(16)
        .text(money(settlement.montoTotal), left + 14, y + 49);
      const payment =
        settlement.estado === 'pagada'
          ? `${String(settlement.metodoPago ?? '').toUpperCase()}${
              settlement.referenciaPago
                ? ` | Ref. ${settlement.referenciaPago}`
                : ''
            }`
          : 'Pago pendiente de registro';
      doc
        .fillColor('#64748b')
        .font(fonts.regular)
        .fontSize(8)
        .text(payment, left + 220, y + 50, {
          width: width - 234,
          align: 'right',
        });
      doc
        .fillColor('#94a3b8')
        .font(fonts.regular)
        .fontSize(7)
        .text(
          'Documento administrativo generado por Norbitex. Los importes se calculan desde la liquidacion mensual cerrada.',
          left,
          doc.page.height - 40,
          { width, align: 'center' },
        );
    });

    return {
      buffer,
      fileName: `guia-pago-${settlement.afiliado.codigo}-${settlement.periodo}.pdf`,
    };
  }

  private createSettlementPdf(render: (doc: PDFKit.PDFDocument) => void) {
    return new Promise<Buffer>((resolveBuffer, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 42, right: 42, bottom: 52, left: 42 },
        compress: false,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolveBuffer(Buffer.concat(chunks)));
      doc.on('error', reject);
      render(doc);
      doc.end();
    });
  }

  private pdfFonts(doc: PDFKit.PDFDocument) {
    const dir = resolve(process.cwd(), '..', '..', 'nobitex', 'public', 'font');
    const regular = resolve(dir, 'PlusJakartaSans-Regular.ttf');
    const bold = resolve(dir, 'PlusJakartaSans-Bold.ttf');
    if (existsSync(regular) && existsSync(bold)) {
      doc.registerFont('Jakarta', regular);
      doc.registerFont('JakartaBold', bold);
      return { regular: 'Jakarta', bold: 'JakartaBold' };
    }
    return { regular: 'Helvetica', bold: 'Helvetica-Bold' };
  }

  private affiliateData(
    dto: SaveAffiliateDto,
    code: string,
    discount: Prisma.Decimal,
    commission: Prisma.Decimal,
    actorId: bigint,
  ) {
    return {
      codigo: code,
      codigoKey: code,
      nombre: dto.name,
      documento: dto.document || null,
      email: dto.email || null,
      telefono: dto.phone || null,
      descuentoPorcentaje: discount,
      comisionPorcentaje: commission,
      estado: dto.status ?? AfiliadoEstado.activo,
      actualizadoPorId: actorId,
    };
  }

  private percent(value: string, label: string) {
    const result = new Prisma.Decimal(value);
    if (result.lt(0) || result.gt(50) || result.decimalPlaces() > 2) {
      throw new BadRequestException(
        `El porcentaje de ${label} debe estar entre 0 y 50`,
      );
    }
    return result;
  }

  private invalidCode() {
    return new NotFoundException({
      code: 'AFFILIATE_CODE_INVALID',
      message: 'Codigo de afiliado no valido',
    });
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

  private meta(page: number, limit: number, total: number) {
    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private settlementInclude() {
    return { afiliado: true, cerradaPor: true, pagadaPor: true } as const;
  }

  private mapSettlement(
    row: Prisma.LiquidacionAfiliadoGetPayload<{
      include: ReturnType<PlatformAffiliatesService['settlementInclude']>;
    }>,
  ) {
    const user = (value: typeof row.cerradaPor | null) =>
      value
        ? {
            id: value.id.toString(),
            name: [value.nombre, value.apellido].filter(Boolean).join(' '),
            email: value.email,
          }
        : null;
    return {
      id: row.id.toString(),
      requestId: row.requestId,
      affiliate: {
        id: row.afiliado.id.toString(),
        code: row.afiliado.codigo,
        name: row.afiliado.nombre,
      },
      period: row.periodo,
      count: row.cantidad,
      totalAmount: row.montoTotal.toFixed(2),
      status: row.estado,
      paymentMethod: row.metodoPago,
      paymentReference: row.referenciaPago,
      closedBy: user(row.cerradaPor),
      paidBy: user(row.pagadaPor),
      paidAt: row.pagadoAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
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
        if (
          !(
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2034'
          ) ||
          attempt === 2
        )
          throw error;
      }
    }
    throw new ConflictException('No se pudo completar la operacion');
  }
}

export function getLimaPeriod(value: Date) {
  const lima = new Date(value.getTime() - 5 * 60 * 60 * 1000);
  return `${lima.getUTCFullYear()}-${String(lima.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function calculateAffiliatePricing(
  planTotal: Prisma.Decimal,
  discountPercent: Prisma.Decimal,
  commissionPercent: Prisma.Decimal,
) {
  const discountAmount = planTotal
    .mul(discountPercent)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const total = planTotal.minus(discountAmount).toDecimalPlaces(2);
  const commissionAmount = total
    .mul(commissionPercent)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { discountAmount, total, commissionAmount };
}
