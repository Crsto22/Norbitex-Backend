import { BillingEnvironment } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { BillingWebhookService } from './billing-webhook.service';

describe('BillingWebhookService', () => {
  it('verifica y aplica un webhook de baja SUNAT', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = {
      id: '00000000-0000-4000-8000-000000000010',
      type: 'sunat_void.accepted',
      createdAt: new Date().toISOString(),
      data: {
        voidRequest: {
          id: '00000000-0000-4000-8000-000000000011',
          environment: BillingEnvironment.BETA,
          procedure: 'VOIDED_DOCUMENTS',
          status: 'ACCEPTED',
          reason: 'Documento no otorgado',
          resource: {
            id: '00000000-0000-4000-8000-000000000012',
            externalId: 'sale-public-id',
          },
          ticket: 'ticket-1',
          sunat: { code: '0', message: 'Aceptado' },
          updatedAt: new Date().toISOString(),
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const secret = 'webhook-test-secret';
    const signature = `v1=${createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`, 'utf8')
      .digest('hex')}`;
    const prisma = {
      venta: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10n,
          empresaId: 1n,
          empresa: {
            billingIntegration: {
              empresaId: 1n,
              applicationId: '00000000-0000-4000-8000-000000000020',
              betaWebhookSecretEncrypted: 'encrypted',
              productionWebhookSecretEncrypted: null,
            },
          },
        }),
      },
      notaCredito: { findUnique: jest.fn().mockResolvedValue(null) },
      notaDebito: { findUnique: jest.fn().mockResolvedValue(null) },
      billingWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const voids = { apply: jest.fn().mockResolvedValue(undefined) };
    const service = new BillingWebhookService(
      prisma as never,
      { decrypt: jest.fn().mockReturnValue(secret) } as never,
      { applyDocument: jest.fn() } as never,
      voids as never,
      { applyDocument: jest.fn() } as never,
      { applyDocument: jest.fn() } as never,
      { applyWebhook: jest.fn(), applyVoidWebhook: jest.fn() } as never,
    );

    await expect(
      service.receive({
        eventId: payload.id,
        eventType: payload.type,
        timestamp,
        signature,
        rawBody,
        payload,
      }),
    ).resolves.toEqual({ received: true, duplicate: false });
    expect(voids.apply).toHaveBeenCalledWith(10n, payload.data.voidRequest);
  });

  it('dirige eventos credit-note al documento fiscal de la nota', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = {
      id: '00000000-0000-4000-8000-000000000030',
      type: 'document.accepted',
      createdAt: new Date().toISOString(),
      data: {
        document: {
          id: '00000000-0000-4000-8000-000000000031',
          externalId: 'credit-note:note-public-id',
          environment: BillingEnvironment.BETA,
          status: 'ACCEPTED',
          series: 'FC01',
          number: 1,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const secret = 'webhook-test-secret';
    const signature = `v1=${createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`, 'utf8')
      .digest('hex')}`;
    const prisma = {
      venta: { findUnique: jest.fn() },
      notaCredito: {
        findUnique: jest.fn().mockResolvedValue({
          id: 20n,
          empresaId: 1n,
          empresa: {
            billingIntegration: {
              empresaId: 1n,
              applicationId: '00000000-0000-4000-8000-000000000020',
              betaWebhookSecretEncrypted: 'encrypted',
            },
          },
        }),
      },
      notaDebito: { findUnique: jest.fn().mockResolvedValue(null) },
      billingWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const creditNotes = {
      applyDocument: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BillingWebhookService(
      prisma as never,
      { decrypt: jest.fn().mockReturnValue(secret) } as never,
      { applyDocument: jest.fn() } as never,
      { apply: jest.fn() } as never,
      creditNotes as never,
      { applyDocument: jest.fn() } as never,
      { applyWebhook: jest.fn(), applyVoidWebhook: jest.fn() } as never,
    );

    await service.receive({
      eventId: payload.id,
      eventType: payload.type,
      timestamp,
      signature,
      rawBody,
      payload,
    });

    expect(creditNotes.applyDocument).toHaveBeenCalledWith(
      20n,
      payload.data.document,
    );
  });

  it('dirige eventos debit-note al documento fiscal de la nota', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = {
      id: '00000000-0000-4000-8000-000000000035',
      type: 'document.accepted',
      createdAt: new Date().toISOString(),
      data: {
        document: {
          id: '00000000-0000-4000-8000-000000000036',
          externalId: 'debit-note:debit-public-id',
          environment: BillingEnvironment.BETA,
          status: 'ACCEPTED',
          series: 'FD01',
          number: 1,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const secret = 'webhook-test-secret';
    const signature = `v1=${createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`, 'utf8')
      .digest('hex')}`;
    const debitNotes = {
      applyDocument: jest.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      venta: { findUnique: jest.fn() },
      notaCredito: { findUnique: jest.fn() },
      notaDebito: {
        findUnique: jest.fn().mockResolvedValue({
          id: 25n,
          empresaId: 1n,
          empresa: {
            billingIntegration: {
              applicationId: '00000000-0000-4000-8000-000000000020',
              betaWebhookSecretEncrypted: 'encrypted',
            },
          },
        }),
      },
      guiaRemision: { findUnique: jest.fn() },
      billingWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new BillingWebhookService(
      prisma as never,
      { decrypt: jest.fn().mockReturnValue(secret) } as never,
      { applyDocument: jest.fn() } as never,
      { apply: jest.fn() } as never,
      { applyDocument: jest.fn() } as never,
      debitNotes as never,
      { applyWebhook: jest.fn(), applyVoidWebhook: jest.fn() } as never,
    );

    await service.receive({
      eventId: payload.id,
      eventType: payload.type,
      timestamp,
      signature,
      rawBody,
      payload,
    });

    expect(debitNotes.applyDocument).toHaveBeenCalledWith(
      25n,
      payload.data.document,
    );
  });

  it('dirige eventos despatch-guide a la GRE de la empresa', async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = {
      id: '00000000-0000-4000-8000-000000000040',
      type: 'despatch_guide.beta_validated',
      createdAt: new Date().toISOString(),
      data: {
        despatchGuide: {
          id: '00000000-0000-4000-8000-000000000041',
          externalId: 'despatch-guide:guide-public-id',
          environment: BillingEnvironment.BETA,
          status: 'VALIDATED_BETA',
          series: 'T001',
          number: 1,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const secret = 'webhook-test-secret';
    const signature = `v1=${createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`, 'utf8')
      .digest('hex')}`;
    const prisma = {
      venta: { findUnique: jest.fn() },
      notaCredito: { findUnique: jest.fn() },
      notaDebito: { findUnique: jest.fn() },
      guiaRemision: {
        findUnique: jest.fn().mockResolvedValue({
          id: 30n,
          empresaId: 1n,
          empresa: {
            billingIntegration: {
              applicationId: '00000000-0000-4000-8000-000000000020',
              betaWebhookSecretEncrypted: 'encrypted',
            },
          },
        }),
      },
      billingWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const guides = {
      applyWebhook: jest.fn().mockResolvedValue(true),
      applyVoidWebhook: jest.fn(),
    };
    const service = new BillingWebhookService(
      prisma as never,
      { decrypt: jest.fn().mockReturnValue(secret) } as never,
      { applyDocument: jest.fn() } as never,
      { apply: jest.fn() } as never,
      { applyDocument: jest.fn() } as never,
      { applyDocument: jest.fn() } as never,
      guides as never,
    );

    await service.receive({
      eventId: payload.id,
      eventType: payload.type,
      timestamp,
      signature,
      rawBody,
      payload,
    });

    expect(guides.applyWebhook).toHaveBeenCalledWith(
      1n,
      payload.data.despatchGuide,
    );
  });
});
