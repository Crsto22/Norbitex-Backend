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
    agenciaCourier: { findUnique: jest.fn() },
    ventaEnvio: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const courierAgencies = {
    search: jest.fn(),
    browseForShipping: jest.fn(),
  };
  const service = new ShippingLinksService(
    prisma as unknown as PrismaService,
    courierAgencies as never,
  );
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
    agenciaExternalId: null,
    agenciaNombre: null,
    agenciaDireccion: null,
    agenciaDepartamento: null,
    agenciaProvincia: null,
    agenciaDistrito: null,
    agenciaUbigeo: null,
    agenciaLatitud: null,
    agenciaLongitud: null,
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
    prisma.agenciaCourier.findUnique.mockResolvedValue({
      externalId: '392',
      activo: true,
      nombre: 'Shalom Malvinas',
      direccion: 'Av. Principal 123',
      departamento: 'LIMA',
      provincia: 'LIMA',
      distrito: 'LIMA',
      ubigeo: '150101',
      latitud: -12.04,
      longitud: -77.04,
    });
    prisma.ventaEnvio.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.submitPublic('Abc234Def567', {
        nombreCompleto: '  Maria   Lopez ',
        dni: '12345678',
        celular: '987654321',
        agencia: VentaEnvioAgencia.SHALOM,
        agenciaExternalId: '392',
      }),
    ).resolves.toEqual({ estado: VentaEnvioEstado.recibido });
    expect(prisma.ventaEnvio.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nombreCompleto: 'Maria Lopez',
          agenciaExternalId: '392',
          agenciaNombre: 'Shalom Malvinas',
        }),
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
        agenciaExternalId: '1',
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

  it('solo busca agencias con un enlace vigente y pendiente', async () => {
    prisma.ventaEnvio.findUnique.mockResolvedValue({
      ...pendingShipping,
      venta: {
        estado: VentaEstado.completada,
        correlativo: 'NV01-000001',
        empresa: { nombreComercial: 'Tienda', logoUrl: null },
      },
    });
    courierAgencies.search.mockResolvedValue([{ externalId: '392' }]);

    await expect(
      service.findPublicAgencies('Abc234Def567', {
        agencia: VentaEnvioAgencia.SHALOM,
        q: 'lima',
      }),
    ).resolves.toEqual([{ externalId: '392' }]);
    expect(courierAgencies.search).toHaveBeenCalledWith(
      'SHALOM',
      'lima',
      50,
      undefined,
    );
  });

  it('ordena agencias cercanas usando la ubicacion del cliente', async () => {
    prisma.ventaEnvio.findUnique.mockResolvedValue({
      ...pendingShipping,
      venta: {
        estado: VentaEstado.completada,
        correlativo: 'NV01-000001',
        empresa: { nombreComercial: 'Tienda', logoUrl: null },
      },
    });
    courierAgencies.browseForShipping.mockResolvedValue([
      { externalId: '392', distanceKm: 1.25 },
    ]);

    await service.findPublicAgencies('Abc234Def567', {
      agencia: VentaEnvioAgencia.SHALOM,
      lat: -12.04,
      lng: -77.04,
    });

    expect(courierAgencies.browseForShipping).toHaveBeenCalledWith('SHALOM', {
      latitude: -12.04,
      longitude: -77.04,
    });
  });
});
