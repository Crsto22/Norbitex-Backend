import {
  EmpresaEstado,
  PagoSuscripcionEstado,
  PagoSuscripcionMetodo,
  PlanCodigo,
  Prisma,
  PlataformaComprobanteTipo,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import {
  addCalendarMonthsClamped,
  isSerializationConflict,
  PlatformSubscriptionsService,
} from './platform-subscriptions.service';

describe('PlatformSubscriptionsService', () => {
  it('clamps calendar months to the last valid day in Lima', () => {
    const value = new Date('2026-01-31T15:30:00.000Z');

    expect(addCalendarMonthsClamped(value, 1).toISOString()).toBe(
      '2026-02-28T15:30:00.000Z',
    );
  });

  it('recognizes PostgreSQL serialization conflicts returned by raw queries', () => {
    const error = new Prisma.PrismaClientKnownRequestError('serialization', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code: '40001' },
    });

    expect(isSerializationConflict(error)).toBe(true);
  });

  it('extends an active plan and calculates the fixed catalog price', async () => {
    const company = {
      id: 4n,
      nombreComercial: 'Moda Lima',
      estado: EmpresaEstado.activa,
      planCodigo: PlanCodigo.emprendedor,
      planInicioAt: new Date('2026-01-01T15:30:00.000Z'),
      planFinAt: new Date('2026-01-31T15:30:00.000Z'),
    };
    const actor = {
      id: 21n,
      nombre: 'Cristhofer',
      apellido: 'Leonardo',
      email: 'admin@example.com',
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 4n }]),
      tarifaPlan: {
        findUnique: jest.fn().mockResolvedValue({
          planCodigo: PlanCodigo.emprendedor,
          precioMensual: new Prisma.Decimal(49),
          descuentoMensualPorcentaje: new Prisma.Decimal(10),
          descuentoAnualPorcentaje: new Prisma.Decimal(0),
          updatedAt: new Date('2026-01-10T15:30:00.000Z'),
        }),
      },
      limitePlan: {
        findUnique: jest.fn().mockResolvedValue({
          usuarios: 2n,
          sucursales: 1n,
          productos: 500n,
          variantes: 5_000n,
          comprobantes: 500n,
          almacenamientoBytes: 1024n * 1024n * 1024n,
          updatedAt: new Date('2026-01-10T15:30:00.000Z'),
        }),
      },
      plan: {
        findUnique: jest.fn().mockResolvedValue({
          planCodigo: PlanCodigo.emprendedor,
          nombre: 'Emprendedor',
          descripcion: null,
          destacado: false,
          orden: 2,
          color: null,
        }),
      },
      planModulo: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      empresa: {
        findUnique: jest.fn().mockResolvedValue(company),
        update: jest.fn().mockResolvedValue({}),
      },
      pagoSuscripcion: {
        findUnique: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        create: jest
          .fn()
          .mockImplementation(
            ({ data }: { data: Record<string, unknown> }) => ({
              id: 8n,
              createdAt: new Date('2026-01-20T15:30:00.000Z'),
              estado: PagoSuscripcionEstado.pagado,
              moneda: 'PEN',
              incluyeIgv: true,
              motivoAnulacion: null,
              anuladoAt: null,
              anuladoPor: null,
              descuentoManualTipo: null,
              descuentoManualValor: null,
              montoDescuentoManual: new Prisma.Decimal(0),
              empresa: {
                id: company.id,
                nombreComercial: company.nombreComercial,
                ruc: '20123456789',
                dni: null,
              },
              registradoPor: actor,
              ...data,
            }),
          ),
      },
      platformAuditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          (operation: (client: typeof tx) => Promise<unknown>) => operation(tx),
        ),
    } as unknown as PrismaService;
    const service = new PlatformSubscriptionsService(
      prisma,
      new PlansService(tx as unknown as PrismaService),
      {
        createReceiptForSubscription: jest.fn().mockResolvedValue({}),
      } as never,
      {
        resolveSaleContext: jest.fn().mockResolvedValue(null),
        recordSale: jest.fn(),
        cancelSaleCommission: jest.fn(),
      } as never,
    );

    const result = await service.createSale(
      { sub: actor.id.toString(), roles: ['SUPERADMIN'] },
      {
        requestId: '8df8ab44-22e7-4bf1-8417-0ed72d4c2aa9',
        empresaId: company.id.toString(),
        planCode: PlanCodigo.emprendedor,
        months: 1,
        pricingUpdatedAt: '2026-01-10T15:30:00.000Z',
        paymentMethod: PagoSuscripcionMetodo.yape,
        receiptType: PlataformaComprobanteTipo.nota_venta,
      },
      new Date('2026-01-20T15:30:00.000Z'),
    );

    expect(tx.empresa.update).toHaveBeenCalledWith({
      where: { id: company.id },
      data: {
        planCodigo: PlanCodigo.emprendedor,
        planInicioAt: company.planInicioAt,
        planFinAt: new Date('2026-02-28T15:30:00.000Z'),
      },
    });
    expect(result.sale.totalAmount).toBe('49.00');
    expect(result.sale.coverageStartsAt).toBe('2026-01-31T15:30:00.000Z');
  });
});
