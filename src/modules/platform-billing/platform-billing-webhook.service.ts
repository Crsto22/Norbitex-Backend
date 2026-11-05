import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformBillingEmissionService } from './platform-billing-emission.service';
import { PlatformBillingIntegrationService } from './platform-billing-integration.service';

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
export class PlatformBillingWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integration: PlatformBillingIntegrationService,
    private readonly emission: PlatformBillingEmissionService,
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
    const requestId = externalId.startsWith('platform:')
      ? externalId.slice('platform:'.length)
      : '';
    const receipt = await this.prisma.comprobantePlataforma.findUnique({
      where: { requestId },
      select: { id: true },
    });
    const config =
      await this.prisma.configuracionFacturacionPlataforma.findUnique({
        where: { id: 1 },
      });
    if (!receipt || !config?.billingApplicationId) {
      throw new UnauthorizedException('Documento Billing desconocido');
    }
    const environment =
      event.kind === 'document'
        ? event.document.environment
        : event.voidRequest.environment;
    const secret = await this.integration.webhookSecret(environment);
    const expected = `v1=${createHmac('sha256', secret)
      .update(`${timestamp}.${input.rawBody.toString('utf8')}`, 'utf8')
      .digest('hex')}`;
    if (!safeEqual(expected, input.signature)) {
      throw new UnauthorizedException('Firma webhook invalida');
    }
    const existing = await this.prisma.platformBillingWebhookEvent.findUnique({
      where: { eventId: input.eventId },
    });
    if (existing) return { received: true, duplicate: true };
    await this.prisma.platformBillingWebhookEvent.create({
      data: {
        eventId: input.eventId,
        applicationId: config.billingApplicationId,
        environment,
        eventType: input.eventType,
        eventCreatedAt: new Date(event.createdAt),
      },
    });
    try {
      if (event.kind === 'document') {
        await this.emission.applyDocument(receipt.id, event.document);
      } else {
        await this.emission.applyVoid(receipt.id, event.voidRequest);
      }
    } catch (error) {
      await this.prisma.platformBillingWebhookEvent.delete({
        where: { eventId: input.eventId },
      });
      throw error;
    }
    return { received: true, duplicate: false };
  }
}

type WebhookDocument = Parameters<
  PlatformBillingEmissionService['applyDocument']
>[1];
type WebhookVoid = Parameters<PlatformBillingEmissionService['applyVoid']>[1];

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
      voidRequest: WebhookVoid;
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
    resource &&
    typeof resource.externalId === 'string'
  ) {
    return {
      kind: 'void',
      id: value.id,
      type: value.type,
      createdAt: value.createdAt,
      voidRequest: voidRequest as unknown as WebhookVoid,
    };
  }
  throw new BadRequestException('Payload webhook incompleto');
}

function safeEqual(expected: string, actual: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
