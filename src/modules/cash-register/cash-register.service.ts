import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CajaMovimientoTipo,
  CajaSesionEstado,
  MetodoPagoEstado,
  Prisma,
  SucursalTipo,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { CloseCashRegisterDto } from './dto/close-cash-register.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import {
  FindCashRegisterQueryDto,
  FindCurrentCashRegisterQueryDto,
} from './dto/find-cash-register-query.dto';
import {
  CashRegisterAmountDto,
  OpenCashRegisterDto,
} from './dto/open-cash-register.dto';

const cashRegisterInclude = {
  sucursal: { select: { id: true, nombre: true, tipo: true } },
  usuario: { select: { id: true, nombre: true, apellido: true, email: true } },
  movimientos: {
    include: {
      metodoPago: { select: { id: true, nombre: true, nombreKey: true } },
      venta: { select: { publicId: true, correlativo: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.CajaSesionInclude;

type CashRegisterWithRelations = Prisma.CajaSesionGetPayload<{
  include: typeof cashRegisterInclude;
}>;

@Injectable()
export class CashRegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async open(empresaId: bigint, usuarioId: bigint, dto: OpenCashRegisterDto) {
    const sucursalId = this.parseId(dto.sucursalId, 'sucursalId');
    const saldosIniciales = dto.saldosIniciales ?? [];
    const montoInicial = this.sumAmounts(saldosIniciales);

    await this.ensureBranchCanUseCashRegister(empresaId, sucursalId);
    await this.ensurePaymentMethods(empresaId, saldosIniciales);

    try {
      const cashRegister = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.cajaSesion.findFirst({
          where: {
            empresaId,
            sucursalId,
            usuarioId,
            estado: CajaSesionEstado.abierta,
          },
          select: { publicId: true },
        });

        if (existing) {
          throw new ConflictException(
            'Ya tienes una caja abierta en esta sucursal',
          );
        }

        return tx.cajaSesion.create({
          data: {
            empresaId,
            sucursalId,
            usuarioId,
            montoInicial,
            observacionesApertura: this.cleanOptionalText(dto.observaciones),
            movimientos: {
              create: this.toInitialMovementData(
                empresaId,
                usuarioId,
                saldosIniciales,
              ),
            },
          },
          include: cashRegisterInclude,
        });
      });

      return this.toCashRegisterResponse(cashRegister);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya tienes una caja abierta en esta sucursal',
        );
      }

      throw error;
    }
  }

  async current(
    empresaId: bigint,
    usuarioId: bigint,
    query: FindCurrentCashRegisterQueryDto,
  ) {
    const sucursalId = this.parseId(query.sucursalId, 'sucursalId');
    const cashRegister = await this.prisma.cajaSesion.findFirst({
      where: {
        empresaId,
        sucursalId,
        usuarioId,
        estado: CajaSesionEstado.abierta,
      },
      include: cashRegisterInclude,
    });

    return cashRegister ? this.toCashRegisterResponse(cashRegister) : null;
  }

  async createMovement(
    empresaId: bigint,
    usuarioId: bigint,
    dto: CreateCashMovementDto,
  ) {
    const sucursalId = this.parseId(dto.sucursalId, 'sucursalId');
    const metodoPagoId = this.parseId(dto.metodoPagoId, 'metodoPagoId');
    const amount = this.parsePositiveDecimal(dto.monto, 'monto');
    const monto = dto.tipo === 'retiro' ? amount.mul(-1) : amount;
    const motivo = this.cleanRequiredText(dto.motivo, 'motivo');

    await this.ensurePaymentMethod(empresaId, metodoPagoId);

    const movement = await this.prisma.$transaction(async (tx) => {
      const cashRegister = await this.findOpenCashRegister(
        tx,
        empresaId,
        sucursalId,
        usuarioId,
      );

      return tx.cajaMovimiento.create({
        data: {
          empresaId,
          cajaSesionId: cashRegister.id,
          metodoPagoId,
          tipo:
            dto.tipo === 'retiro'
              ? CajaMovimientoTipo.retiro
              : CajaMovimientoTipo.ingreso,
          monto,
          motivo,
          referencia: this.cleanOptionalText(dto.referencia),
          creadoPorId: usuarioId,
        },
        include: {
          metodoPago: { select: { id: true, nombre: true, nombreKey: true } },
          venta: { select: { publicId: true, correlativo: true } },
        },
      });
    });

    return this.toMovementResponse(movement);
  }

  async close(empresaId: bigint, usuarioId: bigint, dto: CloseCashRegisterDto) {
    const sucursalId = this.parseId(dto.sucursalId, 'sucursalId');
    const montoDeclarado = this.sumAmounts(dto.saldosDeclarados);

    await this.ensurePaymentMethods(empresaId, dto.saldosDeclarados);

    const cashRegister = await this.prisma.$transaction(async (tx) => {
      const current = await this.findOpenCashRegister(
        tx,
        empresaId,
        sucursalId,
        usuarioId,
      );
      const montoEsperado = await this.getExpectedAmount(tx, current.id);
      const diferencia = montoDeclarado.sub(montoEsperado);

      return tx.cajaSesion.update({
        where: { id: current.id },
        data: {
          estado: CajaSesionEstado.cerrada,
          closedAt: new Date(),
          montoEsperado,
          montoDeclarado,
          diferencia,
          observacionesCierre: this.cleanOptionalText(dto.observaciones),
        },
        include: cashRegisterInclude,
      });
    });

    return this.toCashRegisterResponse(cashRegister);
  }

  async findAll(empresaId: bigint, query: FindCashRegisterQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const sucursalId = query.sucursalId
      ? this.parseId(query.sucursalId, 'sucursalId')
      : null;
    const usuarioId = query.usuarioId
      ? this.parseId(query.usuarioId, 'usuarioId')
      : null;
    const openedAt = this.buildDateFilter(query.from, query.to);
    const where: Prisma.CajaSesionWhereInput = {
      empresaId,
      ...(sucursalId ? { sucursalId } : {}),
      ...(usuarioId ? { usuarioId } : {}),
      ...(query.estado ? { estado: query.estado } : {}),
      ...(openedAt ? { openedAt } : {}),
    };

    const [cashRegisters, total] = await this.prisma.$transaction([
      this.prisma.cajaSesion.findMany({
        where,
        include: {
          sucursal: { select: { id: true, nombre: true, tipo: true } },
          usuario: {
            select: { id: true, nombre: true, apellido: true, email: true },
          },
        },
        orderBy: { openedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cajaSesion.count({ where }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: cashRegisters.map((cashRegister) =>
        this.toCashRegisterSummaryResponse(cashRegister),
      ),
      meta: { page, limit, total, totalPages },
    };
  }

  async findOne(empresaId: bigint, scope: CommercialScope, publicId: string) {
    const cashRegister = await this.prisma.cajaSesion.findFirst({
      where: {
        empresaId,
        publicId,
        ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
        ...(scopedCreatorId(scope)
          ? { usuarioId: scopedCreatorId(scope)! }
          : {}),
      },
      include: cashRegisterInclude,
    });

    if (!cashRegister) {
      throw new NotFoundException('Caja no encontrada');
    }

    return this.toCashRegisterResponse(cashRegister);
  }

  private async ensureBranchCanUseCashRegister(
    empresaId: bigint,
    sucursalId: bigint,
  ) {
    const sucursal = await this.prisma.sucursal.findFirst({
      where: { id: sucursalId, empresaId, estado: 'activo' },
      select: { tipo: true, modoCajaHabilitado: true },
    });

    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }

    if (sucursal.tipo !== SucursalTipo.tienda) {
      throw new BadRequestException('Solo las tiendas pueden usar caja');
    }

    if (!sucursal.modoCajaHabilitado) {
      throw new BadRequestException(
        'La caja no esta habilitada en esta sucursal',
      );
    }
  }

  private async ensurePaymentMethods(
    empresaId: bigint,
    amounts: CashRegisterAmountDto[],
  ) {
    const ids = Array.from(
      new Set(
        amounts.map((item) => this.parseId(item.metodoPagoId, 'metodoPagoId')),
      ),
    );

    for (const amount of amounts) {
      this.parseNonNegativeDecimal(amount.monto, 'monto');
    }

    if (ids.length === 0) {
      return;
    }

    const found = await this.prisma.metodoPago.count({
      where: {
        id: { in: ids },
        empresaId,
        estado: MetodoPagoEstado.activo,
        deletedAt: null,
      },
    });

    if (found !== ids.length) {
      throw new NotFoundException('Uno o mas metodos de pago no encontrados');
    }
  }

  private async ensurePaymentMethod(empresaId: bigint, metodoPagoId: bigint) {
    const method = await this.prisma.metodoPago.findFirst({
      where: {
        id: metodoPagoId,
        empresaId,
        estado: MetodoPagoEstado.activo,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!method) {
      throw new NotFoundException('Metodo de pago no encontrado');
    }
  }

  private async findOpenCashRegister(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
    sucursalId: bigint,
    usuarioId: bigint,
  ) {
    const cashRegister = await tx.cajaSesion.findFirst({
      where: {
        empresaId,
        sucursalId,
        usuarioId,
        estado: CajaSesionEstado.abierta,
      },
      select: { id: true },
    });

    if (!cashRegister) {
      throw new BadRequestException(
        'No tienes una caja abierta en esta sucursal',
      );
    }

    return cashRegister;
  }

  private async getExpectedAmount(
    tx: Prisma.TransactionClient,
    cajaSesionId: bigint,
  ) {
    const aggregate = await tx.cajaMovimiento.aggregate({
      where: { cajaSesionId },
      _sum: { monto: true },
    });

    return aggregate._sum.monto ?? new Prisma.Decimal(0);
  }

  private toInitialMovementData(
    empresaId: bigint,
    usuarioId: bigint,
    amounts: CashRegisterAmountDto[],
  ) {
    return amounts
      .map((amount) => ({
        empresaId,
        metodoPagoId: this.parseId(amount.metodoPagoId, 'metodoPagoId'),
        tipo: CajaMovimientoTipo.apertura,
        monto: this.parseNonNegativeDecimal(amount.monto, 'monto'),
        motivo: 'Apertura de caja',
        creadoPorId: usuarioId,
      }))
      .filter((movement) => !movement.monto.equals(0));
  }

  private buildDateFilter(from?: string, to?: string) {
    if (!from && !to) {
      return null;
    }

    const filter: Prisma.DateTimeFilter = {};

    if (from) {
      const date = new Date(from);
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException('from debe ser una fecha valida');
      }
      filter.gte = date;
    }

    if (to) {
      const date = new Date(to);
      if (Number.isNaN(date.getTime())) {
        throw new BadRequestException('to debe ser una fecha valida');
      }
      filter.lte = date;
    }

    return filter;
  }

  private sumAmounts(amounts: CashRegisterAmountDto[]) {
    return amounts.reduce(
      (sum, amount) =>
        sum.add(this.parseNonNegativeDecimal(amount.monto, 'monto')),
      new Prisma.Decimal(0),
    );
  }

  private parseId(value: string, fieldName: string) {
    if (!/^\d+$/.test(String(value))) {
      throw new BadRequestException(`${fieldName} debe ser un id valido`);
    }

    return BigInt(value);
  }

  private parsePositiveDecimal(value: string, fieldName: string) {
    const decimal = this.parseDecimal(value, fieldName);
    if (decimal.lte(0)) {
      throw new BadRequestException(`${fieldName} debe ser mayor a cero`);
    }

    return decimal;
  }

  private parseNonNegativeDecimal(value: string, fieldName: string) {
    const decimal = this.parseDecimal(value, fieldName);
    if (decimal.lt(0)) {
      throw new BadRequestException(`${fieldName} no puede ser negativo`);
    }

    return decimal;
  }

  private parseDecimal(value: string, fieldName: string) {
    try {
      const decimal = new Prisma.Decimal(value);
      if (!decimal.isFinite()) {
        throw new Error('Invalid decimal');
      }
      return decimal;
    } catch {
      throw new BadRequestException(`${fieldName} debe ser un monto valido`);
    }
  }

  private cleanRequiredText(value: string, fieldName: string) {
    const cleanValue = value.trim().replace(/\s+/g, ' ');
    if (!cleanValue) {
      throw new BadRequestException(`${fieldName} es obligatorio`);
    }

    return cleanValue;
  }

  private cleanOptionalText(value?: string) {
    const cleanValue = value?.trim().replace(/\s+/g, ' ');
    return cleanValue || null;
  }

  private getDefaultPaginationLimit() {
    const defaultLimit = Number(
      this.configService.get<string>('PAGINATION_DEFAULT_LIMIT') ?? 12,
    );
    const maxLimit = Number(
      this.configService.get<string>('PAGINATION_MAX_LIMIT') ?? 100,
    );

    if (!Number.isInteger(defaultLimit) || defaultLimit <= 0) {
      return 12;
    }

    if (!Number.isInteger(maxLimit) || maxLimit <= 0) {
      return defaultLimit;
    }

    return Math.min(defaultLimit, maxLimit);
  }

  private toCashRegisterResponse(cashRegister: CashRegisterWithRelations) {
    const expectedAmount = cashRegister.movimientos.reduce(
      (sum, movement) => sum.add(movement.monto),
      new Prisma.Decimal(0),
    );

    return {
      ...this.toCashRegisterSummaryResponse(cashRegister),
      montoEsperadoActual: expectedAmount.toFixed(2),
      movimientos: cashRegister.movimientos.map((movement) =>
        this.toMovementResponse(movement),
      ),
      totalesPorMetodoPago: this.buildTotalsByPaymentMethod(
        cashRegister.movimientos,
      ),
    };
  }

  private toCashRegisterSummaryResponse(cashRegister: {
    publicId: string;
    estado: CajaSesionEstado;
    openedAt: Date;
    closedAt: Date | null;
    montoInicial: Prisma.Decimal;
    montoEsperado: Prisma.Decimal | null;
    montoDeclarado: Prisma.Decimal | null;
    diferencia: Prisma.Decimal | null;
    observacionesApertura: string | null;
    observacionesCierre: string | null;
    sucursal: { id: bigint; nombre: string; tipo: SucursalTipo };
    usuario: {
      id: bigint;
      nombre: string;
      apellido: string | null;
      email: string;
    };
  }) {
    return {
      publicId: cashRegister.publicId,
      estado: cashRegister.estado,
      openedAt: cashRegister.openedAt.toISOString(),
      closedAt: cashRegister.closedAt?.toISOString() ?? null,
      montoInicial: cashRegister.montoInicial.toFixed(2),
      montoEsperado: cashRegister.montoEsperado?.toFixed(2) ?? null,
      montoDeclarado: cashRegister.montoDeclarado?.toFixed(2) ?? null,
      diferencia: cashRegister.diferencia?.toFixed(2) ?? null,
      observacionesApertura: cashRegister.observacionesApertura,
      observacionesCierre: cashRegister.observacionesCierre,
      sucursal: {
        id: cashRegister.sucursal.id.toString(),
        nombre: cashRegister.sucursal.nombre,
        tipo: cashRegister.sucursal.tipo,
      },
      usuario: {
        id: cashRegister.usuario.id.toString(),
        nombre: cashRegister.usuario.nombre,
        apellido: cashRegister.usuario.apellido,
        email: cashRegister.usuario.email,
      },
    };
  }

  private toMovementResponse(movement: {
    publicId: string;
    tipo: CajaMovimientoTipo;
    monto: Prisma.Decimal;
    motivo: string | null;
    referencia: string | null;
    createdAt: Date;
    metodoPago: { id: bigint; nombre: string; nombreKey: string } | null;
    venta: { publicId: string; correlativo: string } | null;
  }) {
    return {
      publicId: movement.publicId,
      tipo: movement.tipo,
      monto: movement.monto.toFixed(2),
      motivo: movement.motivo,
      referencia: movement.referencia,
      createdAt: movement.createdAt.toISOString(),
      metodoPago: movement.metodoPago
        ? {
            id: movement.metodoPago.id.toString(),
            nombre: movement.metodoPago.nombre,
            nombreKey: movement.metodoPago.nombreKey,
          }
        : null,
      venta: movement.venta
        ? {
            publicId: movement.venta.publicId,
            correlativo: movement.venta.correlativo,
          }
        : null,
    };
  }

  private buildTotalsByPaymentMethod(
    movements: CashRegisterWithRelations['movimientos'],
  ) {
    const totals = new Map<
      string,
      {
        metodoPago: { id: string; nombre: string; nombreKey: string } | null;
        monto: Prisma.Decimal;
      }
    >();

    for (const movement of movements) {
      const key = movement.metodoPagoId?.toString() ?? 'sin_metodo';
      const current = totals.get(key) ?? {
        metodoPago: movement.metodoPago
          ? {
              id: movement.metodoPago.id.toString(),
              nombre: movement.metodoPago.nombre,
              nombreKey: movement.metodoPago.nombreKey,
            }
          : null,
        monto: new Prisma.Decimal(0),
      };
      current.monto = current.monto.add(movement.monto);
      totals.set(key, current);
    }

    return Array.from(totals.values()).map((item) => ({
      metodoPago: item.metodoPago,
      monto: item.monto.toFixed(2),
    }));
  }
}
