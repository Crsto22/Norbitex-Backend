import { VentaEnvioEstadoLogistico } from '@prisma/client';
import {
  ShalomRegistrationService,
  canAdvanceLogistics,
} from './shalom-registration.service';

describe('canAdvanceLogistics', () => {
  it('avanza de por despachar a en transito', () => {
    expect(
      canAdvanceLogistics(
        VentaEnvioEstadoLogistico.POR_DESPACHAR,
        VentaEnvioEstadoLogistico.EN_TRANSITO,
      ),
    ).toBe(true);
  });

  it('no retrocede de en transito a por despachar', () => {
    expect(
      canAdvanceLogistics(
        VentaEnvioEstadoLogistico.EN_TRANSITO,
        VentaEnvioEstadoLogistico.POR_DESPACHAR,
      ),
    ).toBe(false);
  });

  it('no repite el estado actual', () => {
    expect(
      canAdvanceLogistics(
        VentaEnvioEstadoLogistico.EN_TRANSITO,
        VentaEnvioEstadoLogistico.EN_TRANSITO,
      ),
    ).toBe(false);
  });

  it('permite marcar incidencia desde cualquier estado', () => {
    expect(
      canAdvanceLogistics(
        VentaEnvioEstadoLogistico.EN_TRANSITO,
        VentaEnvioEstadoLogistico.INCIDENCIA,
      ),
    ).toBe(true);
  });

  it('no sale de incidencia', () => {
    expect(
      canAdvanceLogistics(
        VentaEnvioEstadoLogistico.INCIDENCIA,
        VentaEnvioEstadoLogistico.ENTREGADO,
      ),
    ).toBe(false);
  });
});

describe('ShalomRegistrationService.applyTrackingStatus', () => {
  function build(envio: Record<string, unknown>) {
    const prisma = {
      ventaEnvio: {
        findUnique: jest.fn().mockResolvedValue({
          venta: { empresaId: 1n, publicId: 'venta-1' },
          ...envio,
        }),
        update: jest.fn().mockResolvedValue(envio),
      },
      ventaEnvioHistorial: { create: jest.fn().mockResolvedValue({}) },
    };
    const sales = {
      dispatchShalomEnvio: jest
        .fn()
        .mockResolvedValue({ entregaPublicId: 'entrega-1' }),
    };

    const service = new ShalomRegistrationService(
      prisma as never,
      {} as never,
      {} as never,
      sales as never,
    );

    return { prisma, sales, service };
  }

  it('no devuelve a pendiente cuando Shalom reporta EN_ORIGEN tras el despacho', async () => {
    const { prisma, service } = build({
      id: 1n,
      estadoLogistico: VentaEnvioEstadoLogistico.EN_TRANSITO,
      shalomOrden: '104670242',
      shalomRecibidoEn: null,
    });

    await service.applyTrackingStatus(
      1n,
      { status: 'EN_ORIGEN', label: 'En origen', progress: 0 },
      VentaEnvioEstadoLogistico.POR_DESPACHAR,
      null,
    );

    const data = prisma.ventaEnvio.update.mock.calls[0][0].data;
    expect(data.estadoLogistico).toBeUndefined();
    expect(data.shalomRecibidoEn).toBeInstanceOf(Date);
    expect(prisma.ventaEnvioHistorial.create).not.toHaveBeenCalled();
  });

  it('despacha cuando llega EN_ORIGEN y aun no se habia despachado', async () => {
    const { sales, service } = build({
      id: 1n,
      estadoLogistico: VentaEnvioEstadoLogistico.POR_DESPACHAR,
      shalomOrden: '104670242',
      shalomRecibidoEn: null,
    });

    await service.applyTrackingStatus(
      1n,
      { status: 'EN_ORIGEN', label: 'En origen', progress: 0 },
      VentaEnvioEstadoLogistico.POR_DESPACHAR,
      null,
    );

    expect(sales.dispatchShalomEnvio).toHaveBeenCalledWith(1n, 'venta-1', {
      orden: '104670242',
      actorId: null,
    });
  });

  it('avanza a en transito cuando el paquete sale del origen', async () => {
    const { prisma, service } = build({
      id: 1n,
      estadoLogistico: VentaEnvioEstadoLogistico.POR_DESPACHAR,
      shalomOrden: '104670242',
      shalomRecibidoEn: new Date('2026-11-20T10:00:00Z'),
    });

    await service.applyTrackingStatus(
      1n,
      { status: 'EN_TRANSITO', label: 'En transito', progress: 40 },
      VentaEnvioEstadoLogistico.EN_TRANSITO,
      null,
    );

    const data = prisma.ventaEnvio.update.mock.calls[0][0].data;
    expect(data.estadoLogistico).toBe(VentaEnvioEstadoLogistico.EN_TRANSITO);
  });
});
