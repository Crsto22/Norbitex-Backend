import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CajaMovimientoTipo,
  CajaSesionEstado,
  CuentaPorCobrarCuotaEstado,
  CuentaPorCobrarEstado,
  MetodoPagoEstado,
  Prisma,
  SucursalTipo,
  VentaPagoEstado,
  VentaPagoOrigen,
} from '@prisma/client';
import {
  resolveScopedBranchId,
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AnnulReceivablePaymentDto,
  FindAccountsReceivableQueryDto,
  RegisterReceivablePaymentDto,
} from './dto/accounts-receivable.dto';

const accountInclude = {
  cliente: true,
  sucursal: { select: { id: true, nombre: true } },
  venta: {
    select: {
      publicId: true,
      codigoInterno: true,
      correlativo: true,
      tipoComprobante: true,
      formaPago: true,
      estado: true,
      sunatEstado: true,
      createdAt: true,
      creadoPorId: true,
      pagos: {
        include: {
          metodoPago: { select: { id: true, nombre: true } },
          creadoPor: { select: { id: true, nombre: true, apellido: true } },
          aplicaciones: {
            include: { cuota: { select: { numero: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  },
  cuotas: { orderBy: [{ fechaVencimiento: 'asc' }, { numero: 'asc' }] },
} satisfies Prisma.CuentaPorCobrarInclude;

type AccountWithRelations = Prisma.CuentaPorCobrarGetPayload<{
  include: typeof accountInclude;
}>;

@Injectable()
export class AccountsReceivableService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(empresaId: bigint, scope: CommercialScope) {
    const where = this.accessWhere(empresaId, scope);
    const activeWhere: Prisma.CuentaPorCobrarWhereInput = {
      ...where,
      estado: {
        in: [
          CuentaPorCobrarEstado.pendiente,
          CuentaPorCobrarEstado.parcial,
          CuentaPorCobrarEstado.anulacion_pendiente,
        ],
      },
    };
    const today = this.today();
    const monthStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    const [pending, overdue, collected, clients] =
      await this.prisma.$transaction([
        this.prisma.cuentaPorCobrar.aggregate({
          where: activeWhere,
          _sum: { saldoPendiente: true },
        }),
        this.prisma.cuentaPorCobrarCuota.aggregate({
          where: {
            cuentaPorCobrar: activeWhere,
            fechaVencimiento: { lt: today },
            saldo: { gt: 0 },
            estado: { not: CuentaPorCobrarCuotaEstado.anulada },
          },
          _sum: { saldo: true },
        }),
        this.prisma.ventaPago.aggregate({
          where: {
            venta: {
              empresaId,
              cuentaPorCobrar: { is: where },
            },
            origen: VentaPagoOrigen.cobranza,
            estado: VentaPagoEstado.activo,
            createdAt: { gte: monthStart },
          },
          _sum: { monto: true },
        }),
        this.prisma.cuentaPorCobrar.findMany({
          where: activeWhere,
          distinct: ['clienteId'],
          select: { clienteId: true },
        }),
      ]);
    const totalPending = pending._sum.saldoPendiente ?? new Prisma.Decimal(0);
    const totalOverdue = overdue._sum.saldo ?? new Prisma.Decimal(0);

    return {
      totalPendiente: totalPending.toFixed(2),
      totalVencido: totalOverdue.toFixed(2),
      totalPorVencer: Prisma.Decimal.max(
        totalPending.sub(totalOverdue),
        new Prisma.Decimal(0),
      ).toFixed(2),
      cobradoMes: (collected._sum.monto ?? new Prisma.Decimal(0)).toFixed(2),
      clientesConDeuda: clients.length,
    };
  }

  async findAll(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindAccountsReceivableQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const today = this.today();
    const where: Prisma.CuentaPorCobrarWhereInput = {
      ...this.accessWhere(empresaId, scope, query.sucursalId),
      ...(query.clienteId
        ? { clienteId: this.parseId(query.clienteId, 'clienteId') }
        : {}),
      ...(query.estado ? { estado: query.estado } : {}),
      ...(query.situacion === 'vencida'
        ? {
            cuotas: {
              some: { fechaVencimiento: { lt: today }, saldo: { gt: 0 } },
            },
          }
        : query.situacion === 'vigente'
          ? {
              NOT: {
                cuotas: {
                  some: { fechaVencimiento: { lt: today }, saldo: { gt: 0 } },
                },
              },
            }
          : {}),
      ...(query.desde || query.hasta
        ? {
            createdAt: {
              ...(query.desde
                ? { gte: this.parseDate(query.desde, 'desde') }
                : {}),
              ...(query.hasta
                ? { lte: this.endOfDay(this.parseDate(query.hasta, 'hasta')) }
                : {}),
            },
          }
        : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              {
                cliente: {
                  nombre: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              },
              {
                cliente: {
                  razonSocial: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              },
              {
                cliente: {
                  numeroDocumento: { contains: query.search.trim() },
                },
              },
              {
                venta: {
                  correlativo: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.cuentaPorCobrar.findMany({
        where,
        include: accountInclude,
        orderBy: [{ primerVencimiento: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cuentaPorCobrar.count({ where }),
    ]);

    return {
      data: items.map((item) => this.toResponse(item)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(empresaId: bigint, scope: CommercialScope, publicId: string) {
    const account = await this.prisma.cuentaPorCobrar.findFirst({
      where: { publicId, ...this.accessWhere(empresaId, scope) },
      include: accountInclude,
    });
    if (!account)
      throw new NotFoundException('Cuenta por cobrar no encontrada');
    return this.toResponse(account);
  }

  async registerPayment(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
    dto: RegisterReceivablePaymentDto,
  ) {
    const amount = this.parsePositiveAmount(dto.monto, 'monto');
    const methodId = this.parseId(dto.metodoPagoId, 'metodoPagoId');
    const base = await this.prisma.cuentaPorCobrar.findFirst({
      where: { publicId, ...this.accessWhere(empresaId, scope) },
      include: { venta: { select: { id: true } } },
    });
    if (!base) throw new NotFoundException('Cuenta por cobrar no encontrada');

    const existing = await this.prisma.ventaPago.findFirst({
      where: { ventaId: base.ventaId, requestId: dto.requestId },
      select: { id: true },
    });
    if (existing) return this.findOne(empresaId, scope, publicId);

    const method = await this.prisma.metodoPago.findFirst({
      where: {
        id: methodId,
        empresaId,
        estado: MetodoPagoEstado.activo,
        deletedAt: null,
      },
    });
    if (!method) throw new NotFoundException('Metodo de pago no encontrado');

    const received = dto.montoRecibido
      ? this.parsePositiveAmount(dto.montoRecibido, 'montoRecibido')
      : amount;
    if (received.lt(amount)) {
      throw new BadRequestException(
        'El monto recibido no puede ser menor al monto aplicado',
      );
    }
    if (!method.permiteVuelto && !received.equals(amount)) {
      throw new BadRequestException(
        `${method.nombre} no permite vuelto; el monto recibido debe coincidir con el monto aplicado`,
      );
    }

    const requestedBranchId = resolveScopedBranchId(scope, dto.sucursalId);

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "cuenta_por_cobrar" WHERE "id" = ${base.id} FOR UPDATE`;
          const account = await tx.cuentaPorCobrar.findUnique({
            where: { id: base.id },
            include: {
              venta: { select: { id: true, correlativo: true } },
              cuotas: {
                where: { saldo: { gt: 0 } },
                orderBy: [{ fechaVencimiento: 'asc' }, { numero: 'asc' }],
              },
            },
          });
          if (!account) throw new NotFoundException('Cuenta no encontrada');
          if (
            account.estado === CuentaPorCobrarEstado.anulada ||
            account.estado === CuentaPorCobrarEstado.anulacion_pendiente
          ) {
            throw new BadRequestException('La cuenta no admite nuevos pagos');
          }
          if (amount.gt(account.saldoPendiente)) {
            throw new BadRequestException(
              'El abono no puede superar el saldo pendiente',
            );
          }

          const duplicated = await tx.ventaPago.findFirst({
            where: { ventaId: account.ventaId, requestId: dto.requestId },
            select: { id: true },
          });
          if (duplicated) return;

          const branchId = requestedBranchId ?? account.sucursalId;
          const cashSession = branchId
            ? await this.resolveCashSession(
                tx,
                empresaId,
                branchId,
                scope.userId,
              )
            : null;
          const payment = await tx.ventaPago.create({
            data: {
              ventaId: account.ventaId,
              metodoPagoId: method.id,
              creadoPorId: scope.userId,
              requestId: dto.requestId,
              origen: VentaPagoOrigen.cobranza,
              monto: amount,
              montoRecibido: dto.montoRecibido ? received : null,
              vuelto: method.permiteVuelto ? received.sub(amount) : 0,
              referencia: this.cleanOptional(dto.referencia),
            },
          });

          let remaining = amount;
          for (const installment of account.cuotas) {
            if (remaining.lte(0)) break;
            const applied = Prisma.Decimal.min(remaining, installment.saldo);
            const nextPaid = installment.montoPagado.add(applied);
            const nextBalance = installment.saldo.sub(applied);
            await tx.cuentaPorCobrarCuota.update({
              where: { id: installment.id },
              data: {
                montoPagado: nextPaid,
                saldo: nextBalance,
                estado: nextBalance.equals(0)
                  ? CuentaPorCobrarCuotaEstado.pagada
                  : CuentaPorCobrarCuotaEstado.parcial,
              },
            });
            await tx.cuentaPorCobrarAplicacion.create({
              data: {
                cuotaId: installment.id,
                pagoId: payment.id,
                monto: applied,
              },
            });
            remaining = remaining.sub(applied);
          }
          if (remaining.gt(0)) {
            throw new ConflictException(
              'El cronograma no tiene saldo suficiente para aplicar el abono',
            );
          }

          const nextBalance = account.saldoPendiente.sub(amount);
          await tx.cuentaPorCobrar.update({
            where: { id: account.id },
            data: {
              saldoPendiente: nextBalance,
              estado: nextBalance.equals(0)
                ? CuentaPorCobrarEstado.pagada
                : CuentaPorCobrarEstado.parcial,
              ultimoPagoAt: new Date(),
            },
          });

          if (cashSession) {
            await tx.cajaMovimiento.create({
              data: {
                empresaId,
                cajaSesionId: cashSession.id,
                ventaId: account.ventaId,
                ventaPagoId: payment.id,
                metodoPagoId: method.id,
                tipo: CajaMovimientoTipo.cobranza,
                monto: amount,
                motivo: `Cobranza ${account.venta.correlativo}`,
                referencia: this.cleanOptional(dto.referencia),
                creadoPorId: scope.userId,
              },
            });
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.findOne(empresaId, scope, publicId);
      }
      throw error;
    }

    return this.findOne(empresaId, scope, publicId);
  }

  async annulPayment(
    empresaId: bigint,
    scope: CommercialScope,
    paymentPublicId: string,
    dto: AnnulReceivablePaymentDto,
  ) {
    const reason = dto.razon.trim();
    if (!reason) throw new BadRequestException('La razon es obligatoria');
    const payment = await this.prisma.ventaPago.findFirst({
      where: {
        publicId: paymentPublicId,
        origen: VentaPagoOrigen.cobranza,
        venta: {
          empresaId,
          cuentaPorCobrar: { is: this.accessWhere(empresaId, scope) },
        },
      },
      include: {
        venta: { include: { cuentaPorCobrar: true } },
        aplicaciones: { include: { cuota: true } },
        cajaMovimientos: { include: { cajaSesion: true } },
      },
    });
    if (!payment || !payment.venta.cuentaPorCobrar) {
      throw new NotFoundException('Pago de cobranza no encontrado');
    }
    if (payment.estado === VentaPagoEstado.anulado) {
      throw new BadRequestException('El pago ya esta anulado');
    }
    if (
      payment.cajaMovimientos.some(
        (movement) => movement.cajaSesion.estado !== CajaSesionEstado.abierta,
      )
    ) {
      throw new BadRequestException(
        'No se puede anular una cobranza asociada a una caja cerrada',
      );
    }

    const accountId = payment.venta.cuentaPorCobrar.id;
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "cuenta_por_cobrar" WHERE "id" = ${accountId} FOR UPDATE`;
        const account = await tx.cuentaPorCobrar.findUnique({
          where: { id: accountId },
        });
        if (!account || account.estado === CuentaPorCobrarEstado.anulada) {
          throw new BadRequestException('La cuenta no admite anulaciones');
        }

        for (const application of payment.aplicaciones) {
          const nextPaid = Prisma.Decimal.max(
            application.cuota.montoPagado.sub(application.monto),
            new Prisma.Decimal(0),
          );
          const nextBalance = application.cuota.saldo.add(application.monto);
          await tx.cuentaPorCobrarCuota.update({
            where: { id: application.cuotaId },
            data: {
              montoPagado: nextPaid,
              saldo: nextBalance,
              estado: nextPaid.equals(0)
                ? CuentaPorCobrarCuotaEstado.pendiente
                : CuentaPorCobrarCuotaEstado.parcial,
            },
          });
        }
        await tx.cuentaPorCobrarAplicacion.deleteMany({
          where: { pagoId: payment.id },
        });
        await tx.ventaPago.update({
          where: { id: payment.id },
          data: { estado: VentaPagoEstado.anulado },
        });
        const nextBalance = account.saldoPendiente.add(payment.monto);
        const activeCollections = await tx.ventaPago.count({
          where: {
            ventaId: payment.ventaId,
            origen: VentaPagoOrigen.cobranza,
            estado: VentaPagoEstado.activo,
            id: { not: payment.id },
          },
        });
        await tx.cuentaPorCobrar.update({
          where: { id: account.id },
          data: {
            saldoPendiente: nextBalance,
            estado:
              activeCollections > 0 || account.adelanto.gt(0)
                ? CuentaPorCobrarEstado.parcial
                : CuentaPorCobrarEstado.pendiente,
          },
        });
        for (const movement of payment.cajaMovimientos) {
          await tx.cajaMovimiento.create({
            data: {
              empresaId,
              cajaSesionId: movement.cajaSesionId,
              ventaId: payment.ventaId,
              ventaPagoId: payment.id,
              metodoPagoId: payment.metodoPagoId,
              tipo: CajaMovimientoTipo.anulacion_cobranza,
              monto: payment.monto.mul(-1),
              motivo: reason,
              referencia: payment.referencia,
              creadoPorId: scope.userId,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.findOne(
      empresaId,
      scope,
      payment.venta.cuentaPorCobrar.publicId,
    );
  }

  private accessWhere(
    empresaId: bigint,
    scope: CommercialScope,
    requestedBranchId?: string,
  ): Prisma.CuentaPorCobrarWhereInput {
    const branchId = resolveScopedBranchId(scope, requestedBranchId);
    const creatorId = scopedCreatorId(scope);
    return {
      empresaId,
      ...(branchId ? { sucursalId: branchId } : {}),
      ...(creatorId ? { venta: { creadoPorId: creatorId } } : {}),
    };
  }

  private async resolveCashSession(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
    branchId: bigint,
    userId: bigint,
  ) {
    const branch = await tx.sucursal.findFirst({
      where: {
        id: branchId,
        empresaId,
        estado: 'activo',
        tipo: SucursalTipo.tienda,
      },
      select: { modoCajaHabilitado: true },
    });
    if (!branch) throw new NotFoundException('Sucursal no encontrada');
    if (!branch.modoCajaHabilitado) return null;
    const session = await tx.cajaSesion.findFirst({
      where: {
        empresaId,
        sucursalId: branchId,
        usuarioId: userId,
        estado: CajaSesionEstado.abierta,
      },
      select: { id: true },
    });
    if (!session) {
      throw new BadRequestException(
        'Debes abrir caja en esta sucursal antes de registrar el abono',
      );
    }
    return session;
  }

  private toResponse(account: AccountWithRelations) {
    const today = this.today();
    return {
      publicId: account.publicId,
      moneda: account.moneda,
      totalVenta: account.totalVenta.toFixed(2),
      adelanto: account.adelanto.toFixed(2),
      saldoInicial: account.saldoInicial.toFixed(2),
      saldoPendiente: account.saldoPendiente.toFixed(2),
      saldoFavor: account.saldoFavor.toFixed(2),
      estado: account.estado,
      vencida: account.cuotas.some(
        (cuota) => cuota.saldo.gt(0) && cuota.fechaVencimiento < today,
      ),
      primerVencimiento: account.primerVencimiento.toISOString().slice(0, 10),
      ultimoPagoAt: account.ultimoPagoAt?.toISOString() ?? null,
      createdAt: account.createdAt.toISOString(),
      cliente: {
        id: account.cliente.id.toString(),
        nombre: account.cliente.nombre,
        razonSocial: account.cliente.razonSocial,
        tipoDocumento: account.cliente.tipoDocumento,
        numeroDocumento: account.cliente.numeroDocumento,
        telefono: account.cliente.telefono,
        email: account.cliente.email,
      },
      sucursal: account.sucursal
        ? {
            id: account.sucursal.id.toString(),
            nombre: account.sucursal.nombre,
          }
        : null,
      venta: {
        publicId: account.venta.publicId,
        codigoInterno: account.venta.codigoInterno,
        correlativo: account.venta.correlativo,
        tipoComprobante: account.venta.tipoComprobante,
        formaPago: account.venta.formaPago,
        estado: account.venta.estado,
        sunatEstado: account.venta.sunatEstado,
        createdAt: account.venta.createdAt.toISOString(),
      },
      cuotas: account.cuotas.map((cuota) => ({
        numero: cuota.numero,
        fechaVencimiento: cuota.fechaVencimiento.toISOString().slice(0, 10),
        montoOriginal: cuota.montoOriginal.toFixed(2),
        montoPagado: cuota.montoPagado.toFixed(2),
        saldo: cuota.saldo.toFixed(2),
        estado: cuota.estado,
        vencida: cuota.saldo.gt(0) && cuota.fechaVencimiento < today,
      })),
      pagos: account.venta.pagos.map((payment) => ({
        publicId: payment.publicId,
        origen: payment.origen,
        monto: payment.monto.toFixed(2),
        montoRecibido: payment.montoRecibido?.toFixed(2) ?? null,
        vuelto: payment.vuelto.toFixed(2),
        referencia: payment.referencia,
        estado: payment.estado,
        createdAt: payment.createdAt.toISOString(),
        metodoPago: {
          id: payment.metodoPago.id.toString(),
          nombre: payment.metodoPago.nombre,
        },
        creadoPor: payment.creadoPor
          ? {
              id: payment.creadoPor.id.toString(),
              nombre: [payment.creadoPor.nombre, payment.creadoPor.apellido]
                .filter(Boolean)
                .join(' '),
            }
          : null,
        cuotas: payment.aplicaciones.map((application) => ({
          numero: application.cuota.numero,
          monto: application.monto.toFixed(2),
        })),
      })),
    };
  }

  private today() {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }

  private parseDate(value: string, field: string) {
    const key = value.slice(0, 10);
    const date = new Date(`${key}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} debe ser una fecha valida`);
    }
    return date;
  }

  private endOfDay(date: Date) {
    return new Date(date.getTime() + 86_400_000 - 1);
  }

  private parseId(value: string, field: string) {
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${field} debe ser un id valido`);
    }
    return BigInt(value);
  }

  private parsePositiveAmount(value: string, field: string) {
    try {
      const amount = new Prisma.Decimal(value);
      if (!amount.isFinite() || amount.lte(0)) throw new Error('invalid');
      return amount;
    } catch {
      throw new BadRequestException(`${field} debe ser un monto mayor a cero`);
    }
  }

  private cleanOptional(value?: string) {
    const cleaned = value?.trim();
    return cleaned || null;
  }
}
