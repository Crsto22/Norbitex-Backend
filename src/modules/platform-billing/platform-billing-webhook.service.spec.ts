import { UnauthorizedException } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { BillingEnvironment } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { PlatformBillingWebhookService } from './platform-billing-webhook.service';

describe('PlatformBillingWebhookService', () => {
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const payload = {
    id: 'event-1',
    type: 'document.accepted',
    createdAt: '2026-11-04T20:00:00.000Z',
    data: {
      document: {
        id: '14a875f0-c79e-42f5-a72d-90b9ad966a54',
        externalId: 'platform:request-1',
        environment: BillingEnvironment.BETA,
        status: 'ACCEPTED',
        updatedAt: '2026-11-04T20:00:00.000Z',
      },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));

  function setup(existing: object | null = null) {
    const prisma = {
      comprobantePlataforma: {
        findUnique: jest.fn().mockResolvedValue({ id: 8n }),
      },
      configuracionFacturacionPlataforma: {
        findUnique: jest.fn().mockResolvedValue({
          billingApplicationId: '857b747a-cef8-42ea-b5e7-5d91de8fd88e',
        }),
      },
      platformBillingWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const integration = {
      webhookSecret: jest.fn().mockResolvedValue('secret'),
    };
    const emission = { applyDocument: jest.fn().mockResolvedValue(undefined) };
    return {
      prisma,
      emission,
      service: new PlatformBillingWebhookService(
        prisma as never,
        integration as never,
        emission as never,
      ),
    };
  }

  it('verifica la firma y procesa el evento una sola vez', async () => {
    const { service, emission, prisma } = setup();
    const signature = `v1=${createHmac('sha256', 'secret')
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex')}`;

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
    expect(emission.applyDocument).toHaveBeenCalledTimes(1);
    expect(prisma.platformBillingWebhookEvent.create).toHaveBeenCalledTimes(1);
  });

  it('rechaza una firma invalida antes de registrar el evento', async () => {
    const { service, prisma } = setup();
    await expect(
      service.receive({
        eventId: payload.id,
        eventType: payload.type,
        timestamp,
        signature: 'v1=incorrecta',
        rawBody,
        payload,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.platformBillingWebhookEvent.create).not.toHaveBeenCalled();
  });
});
