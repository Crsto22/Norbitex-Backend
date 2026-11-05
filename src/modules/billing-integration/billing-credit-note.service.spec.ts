import {
  BillingDocumentStatus,
  BillingEnvironment,
  SunatEstado,
} from '@prisma/client';
import { BillingCreditNoteService } from './billing-credit-note.service';

describe('BillingCreditNoteService', () => {
  it('guarda correlativo Billing y aplica los efectos aceptados una sola vez', async () => {
    const noteUpdate = jest.fn().mockResolvedValue({});
    const seriesUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      notaCredito: {
        findUnique: jest.fn().mockResolvedValue({
          billingUpdatedAt: null,
          serieComprobanteId: 3n,
          sunatEstado: SunatEstado.pendiente_envio,
        }),
        update: noteUpdate,
      },
      serieComprobante: { updateMany: seriesUpdate },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        Promise.resolve(callback(prisma)),
      ),
    };
    const effects = {
      applyAcceptedEffects: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BillingCreditNoteService(
      prisma as never,
      {} as never,
      {} as never,
      effects as never,
    );

    await service.applyDocument(9n, {
      id: '00000000-0000-4000-8000-000000000001',
      externalId: 'credit-note:note-public-id',
      status: BillingDocumentStatus.ACCEPTED,
      series: 'FC01',
      number: 7,
      fullNumber: 'FC01-00000007',
      environment: BillingEnvironment.BETA,
      updatedAt: '2026-11-05T12:00:00.000Z',
      sunat: { code: '0', message: 'Aceptado' },
    });

    expect(noteUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 9n },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({
          numero: 7,
          correlativo: 'FC01-00000007',
          billingStatus: BillingDocumentStatus.ACCEPTED,
          sunatEstado: SunatEstado.aceptado,
        }),
      }),
    );
    expect(seriesUpdate).toHaveBeenCalledWith({
      where: { id: 3n, numeroActual: { lt: 7 } },
      data: { numeroActual: 7 },
    });
    expect(effects.applyAcceptedEffects).toHaveBeenCalledWith(9n);
  });

  it('ignora un evento anterior al ultimo estado aplicado', async () => {
    const update = jest.fn();
    const prisma = {
      notaCredito: {
        findUnique: jest.fn().mockResolvedValue({
          billingUpdatedAt: new Date('2026-11-05T13:00:00.000Z'),
          serieComprobanteId: 3n,
          sunatEstado: SunatEstado.enviando,
        }),
        update,
      },
    };
    const service = new BillingCreditNoteService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.applyDocument(9n, {
      id: '00000000-0000-4000-8000-000000000001',
      externalId: 'credit-note:note-public-id',
      status: BillingDocumentStatus.PROCESSING,
      series: 'FC01',
      number: 7,
      environment: BillingEnvironment.BETA,
      updatedAt: '2026-11-05T12:00:00.000Z',
    });

    expect(update).not.toHaveBeenCalled();
  });
});
