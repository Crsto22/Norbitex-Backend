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
});
