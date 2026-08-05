import { BadRequestException } from '@nestjs/common';
import {
  EmpresaEstado,
  PlanCodigo,
  Prisma,
  UsuarioEstado,
  type PrismaClient,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { PlatformAdminService } from './platform-admin.service';

describe('PlatformAdminService', () => {
  it('calculates commercial summary and plan distribution', async () => {
    const empresa = {
      count: jest
        .fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([
          { planCodigo: PlanCodigo.prueba, _count: 2 },
          { planCodigo: PlanCodigo.emprendedor, _count: 3 },
          { planCodigo: PlanCodigo.crecimiento, _count: 2 },
          { planCodigo: PlanCodigo.empresarial, _count: 1 },
        ])
        .mockResolvedValueOnce([
          { planCodigo: PlanCodigo.emprendedor, _count: 2 },
          { planCodigo: PlanCodigo.crecimiento, _count: 1 },
          { planCodigo: PlanCodigo.empresarial, _count: 1 },
        ]),
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          { createdAt: new Date('2026-02-15T15:00:00.000Z') },
          { createdAt: new Date('2026-07-10T15:00:00.000Z') },
        ])
        .mockResolvedValueOnce([
          {
            id: 20n,
            nombreComercial: 'Empresa reciente',
            ruc: '20123456789',
            dni: null,
            estado: EmpresaEstado.activa,
            planCodigo: PlanCodigo.emprendedor,
            planInicioAt: new Date('2026-07-10T15:00:00.000Z'),
            planFinAt: new Date('2026-08-10T15:00:00.000Z'),
            createdAt: new Date('2026-07-10T15:00:00.000Z'),
          },
        ]),
    } as unknown as PrismaClient['empresa'];
    const updatedAt = new Date('2026-07-01T12:00:00.000Z');
    const prisma = {
      empresa,
      tarifaPlan: {
        findMany: jest.fn().mockResolvedValue([
          {
            planCodigo: PlanCodigo.prueba,
            precioMensual: new Prisma.Decimal(0),
            descuentoMensualPorcentaje: new Prisma.Decimal(0),
            descuentoAnualPorcentaje: new Prisma.Decimal(0),
            updatedAt,
          },
          {
            planCodigo: PlanCodigo.basico,
            precioMensual: new Prisma.Decimal(39),
            descuentoMensualPorcentaje: new Prisma.Decimal(0),
            descuentoAnualPorcentaje: new Prisma.Decimal(10),
            updatedAt,
          },
          {
            planCodigo: PlanCodigo.emprendedor,
            precioMensual: new Prisma.Decimal(79),
            descuentoMensualPorcentaje: new Prisma.Decimal(0),
            descuentoAnualPorcentaje: new Prisma.Decimal(10),
            updatedAt,
          },
          {
            planCodigo: PlanCodigo.crecimiento,
            precioMensual: new Prisma.Decimal(149),
            descuentoMensualPorcentaje: new Prisma.Decimal(0),
            descuentoAnualPorcentaje: new Prisma.Decimal(10),
            updatedAt,
          },
          {
            planCodigo: PlanCodigo.empresarial,
            precioMensual: new Prisma.Decimal(299),
            descuentoMensualPorcentaje: new Prisma.Decimal(0),
            descuentoAnualPorcentaje: new Prisma.Decimal(10),
            updatedAt,
          },
        ]),
      },
      limitePlan: {
        findMany: jest.fn().mockResolvedValue(
          [
            [PlanCodigo.prueba, 1, 1, 50, 500, 100, 500 * 1024 * 1024],
            [PlanCodigo.basico, 1, 1, 100, 1_000, 250, 3 * 1024 * 1024 * 1024],
            [
              PlanCodigo.emprendedor,
              3,
              2,
              450,
              5_000,
              1_000,
              10 * 1024 * 1024 * 1024,
            ],
            [
              PlanCodigo.crecimiento,
              10,
              3,
              4_500,
              45_000,
              5_000,
              50 * 1024 * 1024 * 1024,
            ],
            [
              PlanCodigo.empresarial,
              30,
              20,
              20_000,
              200_000,
              20_000,
              200 * 1024 * 1024 * 1024,
            ],
          ].map(
            ([
              planCodigo,
              usuarios,
              sucursales,
              productos,
              variantes,
              comprobantes,
              almacenamientoBytes,
            ]) => ({
              planCodigo,
              usuarios: BigInt(usuarios),
              sucursales: BigInt(sucursales),
              productos: BigInt(productos),
              variantes: BigInt(variantes),
              comprobantes: BigInt(comprobantes),
              almacenamientoBytes: BigInt(almacenamientoBytes),
              updatedAt,
            }),
          ),
        ),
      },
      pagoSuscripcion: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { montoTotal: new Prisma.Decimal(248) },
        }),
      },
    } as unknown as PrismaService;
    const plansService = new PlansService(prisma);
    const service = new PlatformAdminService(prisma, plansService);

    const result = await service.getDashboard(
      new Date('2026-07-30T15:00:00.000Z'),
    );

    expect(result.summary).toEqual({
      totalCompanies: 10,
      companiesInPeriod: 2,
      activeTrials: 1,
      activeSubscriptions: 5,
      expiredCompanies: 2,
      totalCollected: '248.00',
    });
    expect(result.planDistribution[0]).toEqual(
      expect.objectContaining({ code: 'prueba', count: 2, percentage: 25 }),
    );
    expect(result.companyTrend).toHaveLength(30);
    expect(
      result.companyTrend.reduce((total, item) => total + item.value, 0),
    ).toBe(1);
    expect(result.recentCompanies[0]).toEqual(
      expect.objectContaining({
        id: '20',
        document: '20123456789',
        planStatus: 'active',
      }),
    );
  });

  it('returns real plan changes with actor and company data', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 8n,
        category: 'plan',
        action: 'plan_changed',
        source: 'cli',
        description: 'Plan cambiado de prueba a emprendedor',
        metadata: { fromPlan: 'prueba', toPlan: 'emprendedor' },
        createdAt: new Date('2026-07-30T15:00:00.000Z'),
        empresa: {
          id: 3n,
          nombreComercial: 'Moda Lima',
          ruc: '20123456789',
          dni: null,
        },
        usuario: {
          id: 4n,
          nombre: 'Ana',
          apellido: 'Quispe',
          email: 'ana@example.com',
        },
      },
    ]);
    const platformAuditLog = {
      findMany,
      count: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
      groupBy: jest
        .fn()
        .mockResolvedValueOnce([{ category: 'plan', _count: { _all: 1 } }])
        .mockResolvedValueOnce([{ source: 'cli', _count: { _all: 1 } }]),
    } as unknown as PrismaClient['platformAuditLog'];
    const prisma = { platformAuditLog } as unknown as PrismaService;
    const service = new PlatformAdminService(
      prisma,
      new PlansService({} as PrismaService),
    );

    const result = await service.findPlanChanges(
      {},
      new Date('2026-07-30T18:00:00.000Z'),
    );

    expect(result.data[0]?.id).toBe('8');
    expect(result.data[0]?.company?.id).toBe('3');
    expect(result.data[0]?.company?.name).toBe('Moda Lima');
    expect(result.data[0]?.actor?.id).toBe('4');
    expect(result.data[0]?.actor?.name).toBe('Ana Quispe');
    expect(result.summary).toEqual({
      total: 1,
      thisMonth: 1,
      companyEvents: 0,
      planEvents: 1,
      registrationEvents: 0,
      historicalEvents: 0,
      cliEvents: 1,
      adminEvents: 0,
      platformAdminEvents: 0,
      subscriptionEvents: 0,
      affiliateEvents: 0,
    });
  });

  it('prevents a platform administrator from deactivating their own account', async () => {
    const service = new PlatformAdminService(
      {} as PrismaService,
      new PlansService({} as PrismaService),
    );

    await expect(
      service.updateUserStatus({ sub: '21', roles: ['SUPERADMIN'] }, '21', {
        estado: UsuarioEstado.inactivo,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
