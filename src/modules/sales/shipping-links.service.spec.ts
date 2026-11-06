/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  VentaEnvioAgencia,
  VentaEnvioEstado,
  VentaEstado,
  VisibilidadOperaciones,
} from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { ShippingLinksService } from './shipping-links.service';

describe('ShippingLinksService', () => {
  const prisma = {
    venta: { findFirst: jest.fn() },
    ventaEnvio: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const service = new ShippingLinksService(prisma as unknown as PrismaService);
  const scope = {
    userId: 7n,
    branchId: null,
    visibility: VisibilidadOperaciones.todas,
    isOwner: true,
  };
  const pendingShipping = {
    id: 10n,
    ventaId: 20n,
    codigoPublico: 'Abc234Def567',
    estado: VentaEnvioEstado.pendiente,
    nombreCompleto: null,
    dni: null,
    celular: null,
    agencia: null,
    recibidoAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('reutiliza el enlace existente mientras no se regenere', async () => {
    prisma.venta.findFirst.mockResolvedValue({
      id: 20n,
      estado: VentaEstado.completada,
      envio: pendingShipping,
    });

    await expect(
      service.generate(1n, scope, 'sale-public-id'),
    ).resolves.toEqual(expect.objectContaining({ codigo: 'Abc234Def567' }));
    expect(prisma.ventaEnvio.create).not.toHaveBeenCalled();
    expect(prisma.ventaEnvio.update).not.toHaveBeenCalled();
  });

  it('regenera el codigo y limpia los datos anteriores', async () => {
    prisma.venta.findFirst.mockResolvedValue({
      id: 20n,
      estado: VentaEstado.completada,
      envio: { ...pendingShipping, estado: VentaEnvioEstado.recibido },
    });
    prisma.ventaEnvio.findUnique.mockResolvedValue(null);
    prisma.ventaEnvio.update.mockImplementation(({ data }) => ({
      ...pendingShipping,
      ...data,
    }));

    await service.generate(1n, scope, 'sale-public-id', true);

    expect(prisma.ventaEnvio.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ventaId: 20n },
        data: expect.objectContaining({
          estado: VentaEnvioEstado.pendiente,
          nombreCompleto: null,
          recibidoAt: null,
        }),
      }),
    );
  });

  it('guarda los datos publicos una sola vez', async () => {
    prisma.ventaEnvio.findUnique.mockResolvedValue({
      ...pendingShipping,
      venta: {
        estado: VentaEstado.completada,
        correlativo: 'NV01-000001',
        empresa: { nombreComercial: 'Tienda', logoUrl: null },
      },
    });
    prisma.ventaEnvio.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.submitPublic('Abc234Def567', {
        nombreCompleto: '  Maria   Lopez ',
        dni: '12345678',
        celular: '987654321',
        agencia: VentaEnvioAgencia.SHALOM,
      }),
    ).resolves.toEqual({ estado: VentaEnvioEstado.recibido });
    expect(prisma.ventaEnvio.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nombreCompleto: 'Maria Lopez' }),
      }),
    );
  });

  it('rechaza un segundo envio de datos', async () => {
    prisma.ventaEnvio.findUnique.mockResolvedValue({
      ...pendingShipping,
      estado: VentaEnvioEstado.recibido,
      venta: {
        estado: VentaEstado.completada,
        correlativo: 'NV01-000001',
        empresa: { nombreComercial: 'Tienda', logoUrl: null },
      },
    });

    await expect(
      service.submitPublic('Abc234Def567', {
        nombreCompleto: 'Maria Lopez',
        dni: '12345678',
        celular: '987654321',
        agencia: VentaEnvioAgencia.OLVA,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('oculta enlaces de ventas anuladas', async () => {
    prisma.ventaEnvio.findUnique.mockResolvedValue({
      ...pendingShipping,
      venta: {
        estado: VentaEstado.anulada,
        correlativo: 'NV01-000001',
        empresa: { nombreComercial: 'Tienda', logoUrl: null },
      },
    });

    await expect(service.getPublic('Abc234Def567')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
