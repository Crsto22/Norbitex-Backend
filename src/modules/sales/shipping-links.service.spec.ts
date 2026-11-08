/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  VentaEnvioAgencia,
  VentaEnvioEstado,
  VentaEnvioEstadoLogistico,
  VentaEntregaEstado,
  VentaEntregaTipo,
  VentaEstado,
  VisibilidadOperaciones,
} from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { ShippingLinksService } from './shipping-links.service';
import { calcularFechasDespacho } from './shipping-dates.util';

describe('ShippingLinksService', () => {
  const prisma = {
    $transaction: jest.fn(),
    venta: { findFirst: jest.fn(), update: jest.fn() },
    ventaDetalle: { updateMany: jest.fn() },
    agenciaCourier: { findUnique: jest.fn() },
    ventaEnvio: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    ventaEnvioHistorial: { create: jest.fn() },
  };
  const courierAgencies = {
    search: jest.fn(),
    browseForShipping: jest.fn(),
  };
  const enviosConfig = {
    enabledMetodos: jest.fn(),
    enabledCourierMetodos: jest.fn(),
    enabledMetodosDetalle: jest.fn(),
    getMetodo: jest.fn(),
    isEnabled: jest.fn(),
    getDespacho: jest.fn(),
    getRecojo: jest.fn(),
  };
  const service = new ShippingLinksService(
    prisma as unknown as PrismaService,
    courierAgencies as never,
    enviosConfig as never,
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
    estadoLogistico: VentaEnvioEstadoLogistico.POR_PREPARAR,
    nombreCompleto: null,
    dni: null,
    tipoDocumento: 'DNI',
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
    despachadoAt: null,
    entregadoAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    enviosConfig.isEnabled.mockResolvedValue(true);
    enviosConfig.enabledMetodos.mockResolvedValue(['SHALOM', 'OLVA']);
    enviosConfig.enabledCourierMetodos.mockResolvedValue(['SHALOM', 'OLVA']);
    enviosConfig.enabledMetodosDetalle.mockResolvedValue([
      {
        metodo: 'RECOJO',
        nombre: 'Recojo en tienda',
        tipo: 'recojo',
        direccion: null,
      },
      { metodo: 'SHALOM', nombre: 'Shalom', tipo: 'courier', direccion: null },
      { metodo: 'OLVA', nombre: 'Olva', tipo: 'courier', direccion: null },
    ]);
    enviosConfig.getMetodo.mockResolvedValue({
      metodo: 'SHALOM',
      nombre: 'Shalom',
      tipo: 'courier',
      activo: true,
      direccion: null,
    });
    enviosConfig.getDespacho.mockResolvedValue({
      diasSemana: [0, 1, 2, 3, 4, 5, 6],
      horaCorte: '23:59',
      anticipacionDias: 0,
      configurado: true,
    });
    enviosConfig.getRecojo.mockResolvedValue({
      diasSemana: [0, 1, 2, 3, 4, 5, 6],
      horaCorte: '23:59',
      anticipacionDias: 0,
      configurado: true,
      usaDespacho: true,
    });
  });

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
      estadoEntrega: VentaEntregaEstado.entregada,
      envio: { ...pendingShipping, estado: VentaEnvioEstado.recibido },
      entregas: [],
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
          estadoLogistico: VentaEnvioEstadoLogistico.POR_PREPARAR,
          nombreCompleto: null,
          recibidoAt: null,
        }),
      }),
    );
  });

  it('convierte una venta inmediata sin entrega real en envio pendiente', async () => {
    prisma.venta.findFirst.mockResolvedValue({
      id: 20n,
      estado: VentaEstado.completada,
      estadoEntrega: VentaEntregaEstado.entregada,
      envio: null,
      entregas: [],
    });
    prisma.ventaEnvio.findUnique.mockResolvedValue(null);
    prisma.ventaEnvio.create.mockResolvedValue(pendingShipping);

    await service.generate(1n, scope, 'sale-public-id');

    expect(prisma.ventaDetalle.updateMany).toHaveBeenCalledWith({
      where: { ventaId: 20n },
      data: { cantidadEntregada: 0 },
    });
    expect(prisma.venta.update).toHaveBeenCalledWith({
      where: { id: 20n },
      data: { estadoEntrega: VentaEntregaEstado.pendiente },
    });
  });

  it('no regenera un enlace despues de un despacho al courier', async () => {
    prisma.venta.findFirst.mockResolvedValue({
      id: 20n,
      estado: VentaEstado.completada,
      estadoEntrega: VentaEntregaEstado.parcial,
      envio: pendingShipping,
      entregas: [{ tipo: VentaEntregaTipo.COURIER }],
    });

    await expect(
      service.generate(1n, scope, 'sale-public-id', true),
    ).rejects.toBeInstanceOf(ConflictException);
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
    const fechaEnvio = calcularFechasDespacho(
      [0, 1, 2, 3, 4, 5, 6],
      '23:59',
    )[0];

    await expect(
      service.submitPublic('Abc234Def567', {
        nombreCompleto: '  Maria   Lopez ',
        dni: '12345678',
        tipoDocumento: 'DNI',
        celular: '987654321',
        metodo: 'SHALOM',
        fechaEnvio,
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
          estadoLogistico: VentaEnvioEstadoLogistico.POR_DESPACHAR,
        }),
      }),
    );
    expect(prisma.ventaEnvioHistorial.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        estadoAnterior: VentaEnvioEstadoLogistico.POR_PREPARAR,
        estadoNuevo: VentaEnvioEstadoLogistico.POR_DESPACHAR,
      }),
    });
  });

  it('calcula la fecha lista para recojo sin que el cliente la envie', async () => {
    enviosConfig.getMetodo.mockResolvedValue({
      metodo: 'RECOJO',
      nombre: 'Recojo en tienda',
      tipo: 'recojo',
      activo: true,
      direccion: 'Av. Tienda 123',
    });
    prisma.ventaEnvio.findUnique.mockResolvedValue({
      ...pendingShipping,
      venta: {
        estado: VentaEstado.completada,
        correlativo: 'NV01-000001',
        empresa: { nombreComercial: 'Tienda', logoUrl: null },
      },
    });
    prisma.ventaEnvio.updateMany.mockResolvedValue({ count: 1 });
    const fechaListo = calcularFechasDespacho(
      [0, 1, 2, 3, 4, 5, 6],
      '23:59',
      0,
    )[0];

    await expect(
      service.submitPublic('Abc234Def567', {
        nombreCompleto: 'Maria Lopez',
        dni: '12345678',
        tipoDocumento: 'DNI',
        celular: '987654321',
        metodo: 'RECOJO',
      }),
    ).resolves.toEqual({ estado: VentaEnvioEstado.recibido });
    expect(prisma.ventaEnvio.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metodoEnvio: 'RECOJO',
          fechaEnvio: new Date(`${fechaListo}T00:00:00.000Z`),
          agenciaNombre: 'Recojo en tienda',
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
        tipoDocumento: 'DNI',
        celular: '987654321',
        metodo: 'OLVA',
        fechaEnvio: '2026-11-10',
        agencia: VentaEnvioAgencia.OLVA,
        agenciaExternalId: '1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza un carnet de extranjeria con longitud invalida', async () => {
    prisma.ventaEnvio.findUnique.mockResolvedValue({
      ...pendingShipping,
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
        tipoDocumento: 'CE',
        celular: '987654321',
        metodo: 'SHALOM',
        fechaEnvio: '2026-11-10',
        agencia: VentaEnvioAgencia.SHALOM,
        agenciaExternalId: '392',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza una fecha de envio no disponible', async () => {
    prisma.ventaEnvio.findUnique.mockResolvedValue({
      ...pendingShipping,
      venta: {
        estado: VentaEstado.completada,
        correlativo: 'NV01-000001',
        empresa: { nombreComercial: 'Tienda', logoUrl: null },
      },
    });
    enviosConfig.getDespacho.mockResolvedValue({
      diasSemana: [1, 2, 3, 4, 5],
      horaCorte: '23:59',
      anticipacionDias: 0,
      configurado: true,
    });

    await expect(
      service.submitPublic('Abc234Def567', {
        nombreCompleto: 'Maria Lopez',
        dni: '12345678',
        tipoDocumento: 'DNI',
        celular: '987654321',
        metodo: 'SHALOM',
        fechaEnvio: '1999-01-01',
        agencia: VentaEnvioAgencia.SHALOM,
        agenciaExternalId: '392',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bloquea la generacion del enlace sin config de despacho', async () => {
    prisma.venta.findFirst.mockResolvedValue({
      id: 20n,
      estado: VentaEstado.completada,
      envio: null,
      entregas: [],
    });
    enviosConfig.getDespacho.mockResolvedValue({
      diasSemana: [],
      horaCorte: '',
      anticipacionDias: 0,
      configurado: false,
    });

    await expect(
      service.generate(1n, scope, 'sale-public-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.ventaEnvio.create).not.toHaveBeenCalled();
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
