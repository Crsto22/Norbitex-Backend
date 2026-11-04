import { BadRequestException } from '@nestjs/common';
import {
  BillingDocumentStatus,
  BillingEnvironment,
  SunatBajaTipo,
  VentaEstado,
  VentaTipoComprobante,
} from '@prisma/client';
import { BillingVoidService } from './billing-void.service';

describe('BillingVoidService', () => {
  const sale = {
    id: 10n,
    empresaId: 1n,
    publicId: 'sale-public-id',
    estado: VentaEstado.completada,
    tipoComprobante: VentaTipoComprobante.factura,
    billingDocumentId: '00000000-0000-4000-8000-000000000001',
    billingEnvironment: BillingEnvironment.BETA,
    billingStatus: BillingDocumentStatus.ACCEPTED,
    billingVoidRequestId: null,
    sunatBajaEstado: null,
    empresa: {
      billingMicroserviceEnabled: true,
      billingIntegration: { status: 'READY' },
    },
  };

  it('registra una baja RA y un outbox VOID sin anular comercialmente', async () => {
    const updateSale = jest.fn(
      (input: {
        data: {
          sunatBajaTipo: SunatBajaTipo;
          billingVoidRequestId: string | null;
        };
      }) => {
        void input;
        return Promise.resolve({});
      },
    );
    const upsertOutbox = jest.fn((input: { create: { operation: string } }) => {
      void input;
      return Promise.resolve({});
    });
    const tx = {
      venta: { update: updateSale },
      cuentaPorCobrar: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      billingOutbox: { upsert: upsertOutbox },
    };
    const prisma = {
      venta: { findFirst: jest.fn().mockResolvedValue(sale) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new BillingVoidService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.request(
      sale.empresaId,
      sale.publicId,
      'Error en la emision',
      false,
    );

    const saleUpdate = updateSale.mock.calls[0][0];
    const outboxUpsert = upsertOutbox.mock.calls[0][0];
    expect(saleUpdate.data.sunatBajaTipo).toBe(SunatBajaTipo.RA);
    expect(saleUpdate.data.billingVoidRequestId).toBeNull();
    expect(outboxUpsert.create.operation).toBe('VOID');
  });

  it('bloquea la baja cuando no se confirma que el documento no fue entregado', async () => {
    const prisma = {
      venta: { findFirst: jest.fn().mockResolvedValue(sale) },
    };
    const service = new BillingVoidService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.request(
        sale.empresaId,
        sale.publicId,
        'Error en la emision',
        true,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ignora eventos de baja anteriores al estado local', async () => {
    const prisma = {
      venta: {
        findUnique: jest.fn().mockResolvedValue({
          billingVoidUpdatedAt: new Date('2026-11-04T12:00:00.000Z'),
        }),
        update: jest.fn(),
      },
    };
    const service = new BillingVoidService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.apply(sale.id, {
      id: '00000000-0000-4000-8000-000000000002',
      status: 'PROCESSING',
      procedure: 'VOIDED_DOCUMENTS',
      environment: BillingEnvironment.BETA,
      resource: {
        id: sale.billingDocumentId,
        externalId: sale.publicId,
      },
      updatedAt: '2026-11-04T11:59:59.000Z',
    });

    expect(prisma.venta.update).not.toHaveBeenCalled();
  });
});
