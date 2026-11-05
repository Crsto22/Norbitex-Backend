import { BillingEnvironment, PlataformaComprobanteTipo } from '@prisma/client';
import { PlatformBillingEmissionService } from './platform-billing-emission.service';

describe('PlatformBillingEmissionService', () => {
  it('aplica el correlativo y estado aceptado devuelto por Billing', async () => {
    const receiptUpdate = jest.fn();
    const seriesUpdate = jest.fn();
    const prisma = {
      comprobantePlataforma: {
        findUnique: jest.fn().mockResolvedValue({
          billingUpdatedAt: null,
          serieId: 9n,
          tipo: PlataformaComprobanteTipo.factura,
        }),
        update: receiptUpdate,
      },
      serieComprobantePlataforma: { updateMany: seriesUpdate },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        Promise.resolve(callback(prisma)),
      ),
    };
    const service = new PlatformBillingEmissionService(
      prisma as never,
      {} as never,
      {} as never,
      { finalizeAcceptedCreditNote: jest.fn() } as never,
    );

    await service.applyDocument(7n, {
      id: '14a875f0-c79e-42f5-a72d-90b9ad966a54',
      externalId: 'platform:request',
      status: 'ACCEPTED',
      series: 'F001',
      number: 42,
      environment: BillingEnvironment.BETA,
      updatedAt: '2026-11-04T20:00:00.000Z',
      sunat: { code: '0', message: 'Aceptado' },
    });

    expect(receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7n },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          numero: 42,
          serie: 'F001',
          estado: 'aceptado',
          billingStatus: 'ACCEPTED',
        }),
      }),
    );
    expect(seriesUpdate).toHaveBeenCalledWith({
      where: { id: 9n, correlativo: { lt: 42 } },
      data: { correlativo: 42 },
    });
  });

  it('ignora eventos anteriores a la ultima actualizacion local', async () => {
    const update = jest.fn();
    const prisma = {
      comprobantePlataforma: {
        findUnique: jest.fn().mockResolvedValue({
          billingUpdatedAt: new Date('2026-11-04T21:00:00.000Z'),
          serieId: 1n,
          tipo: PlataformaComprobanteTipo.boleta,
        }),
        update,
      },
    };
    const service = new PlatformBillingEmissionService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.applyDocument(1n, {
      id: '14a875f0-c79e-42f5-a72d-90b9ad966a54',
      externalId: 'platform:request',
      status: 'PROCESSING',
      series: 'B001',
      number: 1,
      environment: BillingEnvironment.BETA,
      updatedAt: '2026-11-04T20:00:00.000Z',
    });
    expect(update).not.toHaveBeenCalled();
  });
});
