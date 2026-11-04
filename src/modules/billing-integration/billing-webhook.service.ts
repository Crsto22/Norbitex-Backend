import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { BillingEnvironment } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingEmissionService } from './billing-emission.service';
import { BillingVoidRequest, BillingVoidService } from './billing-void.service';

const EVENT_TYPES = new Set([
  'document.processing',
  'document.accepted',
  'document.accepted_with_observations',
  'document.rejected',
  'document.retry_scheduled',
  'document.failed',
  'sunat_void.accepted',
  'sunat_void.rejected',
  'sunat_void.failed',
]);

@Injectable()
export class BillingWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretsCryptoService,
    private readonly emission: BillingEmissionService,
    private readonly voids: BillingVoidService,
  ) {}

  async receive(input: {
    eventId: string;
    eventType: string;
    timestamp: string;
    signature: string;
    rawBody: Buffer;
    payload: unknown;
  }) {
    if (!EVENT_TYPES.has(input.eventType)) {
      throw new BadRequestException('Evento Billing no soportado');
    }
    const timestamp = Number(input.timestamp);
    if (
      !Number.isInteger(timestamp) ||
      Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300
    ) {
      throw new UnauthorizedException('Webhook expirado');
    }
    const event = parseEvent(input.payload);
    if (event.id !== input.eventId || event.type !== input.eventType) {
      throw new UnauthorizedException('Identidad del evento inconsistente');
    }
    const externalId =
      event.kind === 'document'
        ? event.document.externalId
        : event.voidRequest.resource.externalId;
    const sale = await this.prisma.venta.findUnique({
      where: { publicId: externalId },
      select: {
        id: true,
        empresaId: true,
        empresa: { select: { billingIntegration: true } },
      },
    });
    const integration = sale?.empresa.billingIntegration;
    if (!sale || !integration?.applicationId) {
      throw new UnauthorizedException('Documento Billing desconocido');
    }
    const environment =
      event.kind === 'document'
        ? event.document.environment
        : event.voidRequest.environment;
    const encrypted =
      environment === BillingEnvironment.BETA
        ? integration.betaWebhookSecretEncrypted
        : integration.productionWebhookSecretEncrypted;
    if (!encrypted) throw new UnauthorizedException('Webhook no configurado');
    const secret = this.crypto.decrypt(encrypted);
    const expected = `v1=${createHmac('sha256', secret)
      .update(`${timestamp}.${input.rawBody.toString('utf8')}`, 'utf8')
      .digest('hex')}`;
    if (!safeEqual(expected, input.signature)) {
      throw new UnauthorizedException('Firma webhook invalida');
    }

    const existing = await this.prisma.billingWebhookEvent.findUnique({
      where: { eventId: input.eventId },
    });
    if (existing) return { received: true, duplicate: true };

    await this.prisma.billingWebhookEvent.create({
      data: {
        eventId: input.eventId,
        empresaId: integration.empresaId,
        applicationId: integration.applicationId,
        environment,
        eventType: input.eventType,
        eventCreatedAt: new Date(event.createdAt),
      },
    });
    try {
      if (event.kind === 'document') {
        await this.emission.applyDocument(sale.id, event.document);
      } else {
        await this.voids.apply(sale.id, event.voidRequest);
      }
    } catch (error) {
      // No marcar como consumido un evento que no se pudo aplicar. Billing
      // podra reenviarlo con el mismo ID sin que la deduplicacion lo descarte.
      await this.prisma.billingWebhookEvent.delete({
        where: { eventId: input.eventId },
      });
      throw error;
    }
    return { received: true, duplicate: false };
  }
}

type WebhookDocument = Parameters<BillingEmissionService['applyDocument']>[1];

function parseEvent(payload: unknown):
  | {
      kind: 'document';
      id: string;
      type: string;
      createdAt: string;
      document: WebhookDocument;
    }
  | {
      kind: 'void';
      id: string;
      type: string;
      createdAt: string;
      voidRequest: BillingVoidRequest;
    } {
  if (!payload || typeof payload !== 'object') {
    throw new BadRequestException('Webhook invalido');
  }
  const value = payload as Record<string, unknown>;
  const data = value.data as Record<string, unknown> | undefined;
  const document = data?.document as Record<string, unknown> | undefined;
  const voidRequest = data?.voidRequest as Record<string, unknown> | undefined;
  const resource = voidRequest?.resource as Record<string, unknown> | undefined;
  if (
    typeof value.id !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    throw new BadRequestException('Payload webhook incompleto');
  }
  if (
    document &&
    typeof document.id === 'string' &&
    typeof document.externalId === 'string' &&
    typeof document.environment === 'string'
  ) {
    return {
      kind: 'document',
      id: value.id,
      type: value.type,
      createdAt: value.createdAt,
      document: document as unknown as WebhookDocument,
    };
  }
  if (
    voidRequest &&
    typeof voidRequest.id === 'string' &&
    typeof voidRequest.environment === 'string' &&
    typeof voidRequest.status === 'string' &&
    typeof voidRequest.procedure === 'string' &&
    resource &&
    typeof resource.externalId === 'string'
  ) {
    return {
      kind: 'void',
      id: value.id,
      type: value.type,
      createdAt: value.createdAt,
      voidRequest: voidRequest as unknown as BillingVoidRequest,
    };
  }
  throw new BadRequestException('Payload webhook incompleto');
}

function safeEqual(expected: string, actual: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
