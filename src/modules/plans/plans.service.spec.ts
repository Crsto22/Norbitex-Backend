import { ConflictException } from '@nestjs/common';
import { ConsultaDocumentoTipo, PlanCodigo, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { calculatePlanSalePricing, PlansService } from './plans.service';

describe('PlansService', () => {
  const service = new PlansService({} as PrismaService);
  const startsAt = new Date('2026-07-01T12:00:00.000Z');
  const entrepreneurLimits = {
    usuarios: 2n,
    sucursales: 1n,
    almacenes: 5n,
    productos: 500n,
    variantes: 5_000n,
    comprobantes: 500n,
    consultasDocumento: 50n,
    almacenamientoBytes: 1024n * 1024n * 1024n,
    updatedAt: startsAt,
  };

  it('calculates trial, active and expired states from the plan dates', () => {
    expect(
      service.getStatus(
        {
          planCodigo: PlanCodigo.prueba,
          planInicioAt: startsAt,
          planFinAt: new Date('2026-07-08T12:00:00.000Z'),
        },
        new Date('2026-07-07T12:00:00.000Z'),
      ),
    ).toBe('trial');

    expect(
      service.getStatus(
        {
          planCodigo: PlanCodigo.prueba,
          planInicioAt: startsAt,
          planFinAt: new Date('2026-07-08T12:00:00.000Z'),
        },
        new Date('2026-07-08T12:00:00.000Z'),
      ),
    ).toBe('expired');

    expect(
      service.getStatus({
        planCodigo: PlanCodigo.empresarial,
        planInicioAt: startsAt,
        planFinAt: null,
      }),
    ).toBe('active');
  });

  it('intersects assigned modules and limits owners to their plan', () => {
    const company = {
      planCodigo: PlanCodigo.emprendedor,
      planInicioAt: startsAt,
      planFinAt: null,
    };

    expect(
      service.getEffectiveModuleKeys(
        company,
        [],
        ['ventas-pos', 'reportes-clientes'],
      ),
    ).toEqual(['ventas-pos', 'reportes-clientes']);

    expect(
      service.getEffectiveModuleKeys(company, [], ['stock-movimientos']),
    ).toContain('stock-kardex');

    const ownerModules = service.getEffectiveModuleKeys(company, ['OWNER'], []);
    expect(ownerModules).toContain('ventas-pos');
    expect(ownerModules).toContain('reportes-clientes');
    expect(ownerModules).not.toContain('reportes-usuarios');
  });

  it('keeps the basic plan limited to essential operations', () => {
    const modules = service.getDefinition(PlanCodigo.basico).moduleKeys;

    expect(modules).toContain('ventas-pos');
    expect(modules).toContain('comprobantes');
    expect(modules).toContain('reportes-ventas');
    expect(modules).toContain('reportes-productos');
    expect(modules).toContain('stock-kardex');
    expect(modules).not.toContain('caja');
    expect(modules).not.toContain('usuarios');
    expect(modules).not.toContain('gre-remitente');
  });

  it('applies the report and module ladder to commercial plans', () => {
    expect(service.getDefinition(PlanCodigo.emprendedor).moduleKeys).toContain(
      'reportes-clientes',
    );
    expect(
      service.getDefinition(PlanCodigo.emprendedor).moduleKeys,
    ).not.toContain('reportes-usuarios');
    expect(service.getDefinition(PlanCodigo.emprendedor).moduleKeys).toContain(
      'gre-remitente',
    );
    expect(service.getDefinition(PlanCodigo.emprendedor).moduleKeys).toContain(
      'conductores',
    );
    expect(service.getDefinition(PlanCodigo.crecimiento).moduleKeys).toContain(
      'gre-remitente',
    );
    expect(service.getDefinition(PlanCodigo.prueba).moduleKeys).toContain(
      'conductores',
    );
  });

  it('applies monthly and annual discounts only to their durations', () => {
    const monthly = new Prisma.Decimal('49.99');
    const monthlyDiscount = new Prisma.Decimal('10');
    const annualDiscount = new Prisma.Decimal('16.67');
    const oneMonth = calculatePlanSalePricing(
      monthly,
      monthlyDiscount,
      annualDiscount,
      1,
    );
    const annual = calculatePlanSalePricing(
      monthly,
      monthlyDiscount,
      annualDiscount,
      12,
    );
    const semester = calculatePlanSalePricing(
      monthly,
      monthlyDiscount,
      annualDiscount,
      6,
    );

    expect(oneMonth.discountAmount.toFixed(2)).toBe('5.00');
    expect(oneMonth.total.toFixed(2)).toBe('44.99');
    expect(annual.listAmount.toFixed(2)).toBe('599.88');
    expect(annual.discountAmount.toFixed(2)).toBe('100.00');
    expect(annual.total.toFixed(2)).toBe('499.88');
    expect(semester.discountPercent.toFixed(2)).toBe('0.00');
    expect(semester.total.toFixed(2)).toBe('299.94');
  });

  it('rejects a pricing update made from an outdated catalog', async () => {
    const currentUpdatedAt = new Date('2026-07-30T15:00:00.000Z');
    const update = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ plan_codigo: 'emprendedor' }]),
      tarifaPlan: {
        findUnique: jest.fn().mockResolvedValue({
          planCodigo: PlanCodigo.emprendedor,
          precioMensual: new Prisma.Decimal(49),
          descuentoMensualPorcentaje: new Prisma.Decimal(0),
          descuentoAnualPorcentaje: new Prisma.Decimal(0),
          updatedAt: currentUpdatedAt,
        }),
        update,
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
        ),
    } as unknown as PrismaService;
    const pricingService = new PlansService(prisma);

    await expect(
      pricingService.updatePricing(
        { sub: '21', roles: ['SUPERADMIN'] },
        PlanCodigo.emprendedor,
        {
          priceMonthly: '59.00',
          monthlyDiscountPercent: '5.00',
          annualDiscountPercent: '15.00',
          expectedUpdatedAt: '2026-07-29T15:00:00.000Z',
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'PLAN_PRICING_CHANGED' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns structured quota details when a limit is reached', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      empresa: {
        findUnique: jest.fn().mockResolvedValue({
          planCodigo: PlanCodigo.emprendedor,
          planInicioAt: startsAt,
          planFinAt: null,
        }),
      },
      producto: { count: jest.fn().mockResolvedValue(500) },
      empresaLimiteAdicional: { findUnique: jest.fn().mockResolvedValue(null) },
      limitePlan: {
        findUnique: jest.fn().mockResolvedValue(entrepreneurLimits),
      },
    } as unknown as Prisma.TransactionClient;

    let thrown: unknown;
    try {
      await service.assertResourceLimits(tx, 1n, { products: 1 });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    if (!(thrown instanceof ConflictException)) {
      throw new Error('Expected ConflictException');
    }
    expect(thrown.getResponse()).toEqual({
      code: 'PLAN_LIMIT_REACHED',
      message: 'Alcanzaste el limite de productos de tu plan',
      resource: 'products',
      used: 500,
      limit: 500,
    });
  });

  it('counts inactive branches when validating the branch limit', async () => {
    const branchCount = jest.fn().mockResolvedValue(1);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      empresa: {
        findUnique: jest.fn().mockResolvedValue({
          planCodigo: PlanCodigo.emprendedor,
          planInicioAt: startsAt,
          planFinAt: null,
        }),
      },
      sucursal: { count: branchCount },
      empresaLimiteAdicional: { findUnique: jest.fn().mockResolvedValue(null) },
      limitePlan: {
        findUnique: jest.fn().mockResolvedValue(entrepreneurLimits),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      service.assertResourceLimits(tx, 1n, { branches: 1 }),
    ).rejects.toMatchObject({
      response: { code: 'PLAN_LIMIT_REACHED', used: 1, limit: 1 },
    });
    expect(branchCount).toHaveBeenCalledWith({
      where: { empresaId: 1n, tipo: 'tienda' },
    });
  });

  it('adds company bonuses to the plan limits', () => {
    const extras = service.mapAdditionalLimits({
      usuarios: 1n,
      sucursales: 2n,
      almacenes: 3n,
      productos: 100n,
      variantes: 200n,
      comprobantes: 50n,
      consultasDocumento: 25n,
      almacenamientoBytes: 1024n,
    });
    const effective = service.buildEffectiveLimits(
      {
        users: 2,
        branches: 1,
        warehouses: null,
        products: 500,
        variants: 5_000,
        documents: 500,
        documentQueries: 50,
        storageBytes: 1024 * 1024 * 1024,
      },
      extras,
    );

    expect(effective.users).toBe(3);
    expect(effective.warehouses).toBeNull();
    expect(effective.documents).toBe(550);
    expect(effective.documentQueries).toBe(75);
    expect(effective.storageBytes).toBe(1024 * 1024 * 1024 + 1024);
  });

  it('blocks a successful document query when the shared quota is exhausted', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      empresa: {
        findUnique: jest.fn().mockResolvedValue({
          planCodigo: PlanCodigo.emprendedor,
          planInicioAt: startsAt,
          planFinAt: null,
        }),
      },
      limitePlan: {
        findUnique: jest.fn().mockResolvedValue(entrepreneurLimits),
      },
      empresaLimiteAdicional: { findUnique: jest.fn().mockResolvedValue(null) },
      consultaDocumento: { count: jest.fn().mockResolvedValue(50), create },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
        ),
    } as unknown as PrismaService;

    await expect(
      new PlansService(prisma).recordDocumentQuery(
        1n,
        7n,
        ConsultaDocumentoTipo.dni,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'PLAN_LIMIT_REACHED',
        resource: 'documentQueries',
        used: 50,
        limit: 50,
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('allows paid-plan overages and snapshots the configured price', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      empresa: {
        findUnique: jest.fn().mockResolvedValue({
          planCodigo: PlanCodigo.emprendedor,
          planInicioAt: startsAt,
          planFinAt: null,
        }),
      },
      empresaLimiteAdicional: { findUnique: jest.fn().mockResolvedValue(null) },
      limitePlan: {
        findUnique: jest.fn().mockResolvedValue(entrepreneurLimits),
      },
      venta: { count: jest.fn().mockResolvedValue(500) },
      tarifaComprobanteExcedente: {
        findUnique: jest.fn().mockResolvedValue({
          precioUnitario: new Prisma.Decimal('0.20'),
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const result = await service.assessDocumentAllowance(tx, 1n);

    expect(result.isOverage).toBe(true);
    expect(result.unitPrice?.toFixed(2)).toBe('0.20');
    expect(result.limit).toBe(500);
  });

  it('rejects a limits update made from an outdated catalog', async () => {
    const update = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ plan_codigo: 'emprendedor' }]),
      limitePlan: {
        findUnique: jest.fn().mockResolvedValue(entrepreneurLimits),
        update,
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
        ),
    } as unknown as PrismaService;

    await expect(
      new PlansService(prisma).updateLimits(
        { sub: '21', roles: ['SUPERADMIN'] },
        PlanCodigo.emprendedor,
        {
          users: 3,
          branches: 1,
          products: 600,
          variants: 6_000,
          documents: 600,
          documentQueries: 100,
          storageBytes: 2 * 1024 * 1024 * 1024,
          expectedUpdatedAt: '2026-06-30T12:00:00.000Z',
        },
      ),
    ).rejects.toMatchObject({ response: { code: 'PLAN_LIMITS_CHANGED' } });
    expect(update).not.toHaveBeenCalled();
  });
});
