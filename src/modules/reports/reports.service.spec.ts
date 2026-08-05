import { NotFoundException } from '@nestjs/common';
import { Prisma, SucursalTipo, VisibilidadOperaciones } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const fullScope = {
    userId: 1n,
    branchId: null,
    visibility: VisibilidadOperaciones.todas,
    isOwner: false,
  };
  it('rejects a branch that does not belong to the authenticated company', async () => {
    const findBranch = jest.fn().mockResolvedValue(null);
    const prisma = {
      sucursal: {
        findFirst: findBranch,
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    await expect(
      service.findSales(9n, fullScope, {
        sucursalId: '44',
        dateFilter: 'today',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findBranch).toHaveBeenCalledWith({
      where: { id: 44n, empresaId: 9n, tipo: SucursalTipo.tienda },
      select: { id: true },
    });
  });

  it('calculates recurrence and excludes unidentified sales', async () => {
    const groupSalesByClient = jest.fn().mockResolvedValue([
      {
        clienteId: 10n,
        _count: { _all: 2 },
        _sum: { total: new Prisma.Decimal(180) },
      },
      {
        clienteId: 11n,
        _count: { _all: 1 },
        _sum: { total: new Prisma.Decimal(90) },
      },
      {
        clienteId: null,
        _count: { _all: 4 },
        _sum: { total: new Prisma.Decimal(400) },
      },
    ]);
    const prisma = {
      cliente: {
        count: jest.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(3),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10n,
            nombre: 'Cliente frecuente',
            razonSocial: null,
            numeroDocumento: '12345678',
          },
          {
            id: 11n,
            nombre: 'Cliente ocasional',
            razonSocial: null,
            numeroDocumento: '87654321',
          },
        ]),
      },
      venta: {
        groupBy: groupSalesByClient,
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    const result = await service.findClients(7n, fullScope, {
      dateFilter: '7days',
    });

    expect(result.summary).toEqual({
      activeClients: 12,
      newClientsThisMonth: 3,
      recurrenceRate: 50,
    });
    expect(result.topByPurchases).toHaveLength(2);
    expect(result.topByPurchases[0]).toMatchObject({
      clientId: '10',
      purchases: 2,
      amount: '180.00',
    });
    expect(groupSalesByClient).toHaveBeenCalled();
  });

  it('returns zero product turnover when there are no active variants', async () => {
    const prisma = {
      producto: {
        count: jest.fn().mockResolvedValue(0),
      },
      productoVariante: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ventaDetalle: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { cantidad: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma);

    const result = await service.findProducts(3n, fullScope, {
      dateFilter: '30days',
    });

    expect(result.summary).toEqual({
      activeProducts: 0,
      activeVariants: 0,
      outOfStockVariants: 0,
      averageTurnover: 0,
    });
    expect(result.topByUnits).toEqual([]);
    expect(result.topByAmount).toEqual([]);
  });
});
