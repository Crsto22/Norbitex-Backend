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
import { BillingCreditNoteService } from './billing-credit-note.service';
import { BillingDebitNoteService } from './billing-debit-note.service';
import {
  BillingDespatchGuide,
  BillingDespatchGuideService,
} from './billing-despatch-guide.service';

const EVENT_TYPES = new Set([
  'document.processing',
  'document.accepted',
  'document.accepted_with_observations',
  'document.rejected',
  'document.retry_scheduled',
  'document.failed',
  'despatch_guide.processing',
  'despatch_guide.beta_validated',
  'despatch_guide.accepted',
  'despatch_guide.accepted_with_observations',
  'despatch_guide.rejected',
  'despatch_guide.failed',
  'sunat_void.manual_action_required',
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
    private readonly creditNotes: BillingCreditNoteService,
    private readonly debitNotes: BillingDebitNoteService,
    private readonly despatchGuides: BillingDespatchGuideService,
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
        : event.kind === 'despatchGuide'
          ? event.despatchGuide.externalId
          : event.voidRequest.resource.externalId;
    const creditNotePublicId = externalId.startsWith('credit-note:')
      ? externalId.slice('credit-note:'.length)
      : null;
    const debitNotePublicId = externalId.startsWith('debit-note:')
      ? externalId.slice('debit-note:'.length)
      : null;
    const guidePublicId = externalId.startsWith('despatch-guide:')
      ? externalId.slice('despatch-guide:'.length)
      : null;
    const [sale, creditNote, debitNote, guide] = await Promise.all([
      creditNotePublicId || debitNotePublicId || guidePublicId
        ? null
        : this.prisma.venta.findUnique({
            where: { publicId: externalId },
            select: {
              id: true,
              empresaId: true,
              empresa: { select: { billingIntegration: true } },
            },
          }),
      creditNotePublicId
        ? this.prisma.notaCredito.findUnique({
            where: { publicId: creditNotePublicId },
            select: {
              id: true,
              empresaId: true,
              empresa: { select: { billingIntegration: true } },
            },
          })
        : null,
      debitNotePublicId
        ? this.prisma.notaDebito.findUnique({
            where: { publicId: debitNotePublicId },
            select: {
              id: true,
              empresaId: true,
              empresa: { select: { billingIntegration: true } },
            },
          })
        : null,
      guidePublicId
        ? this.prisma.guiaRemision.findUnique({
            where: { publicId: guidePublicId },
            select: {
              id: true,
              empresaId: true,
              empresa: { select: { billingIntegration: true } },
            },
          })
        : null,
    ]);
    const resource = guide ?? debitNote ?? creditNote ?? sale;
    const integration = resource?.empresa.billingIntegration;
    if (!resource || !integration?.applicationId) {
      throw new UnauthorizedException('Documento Billing desconocido');
    }
    if (event.kind === 'void' && !sale && !guide) {
      throw new UnauthorizedException('Baja Billing desconocida');
    }
    const environment =
      event.kind === 'document'
        ? event.document.environment
        : event.kind === 'despatchGuide'
          ? event.despatchGuide.environment
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
        empresaId: resource.empresaId,
        applicationId: integration.applicationId,
        environment,
        eventType: input.eventType,
        eventCreatedAt: new Date(event.createdAt),
      },
    });
    try {
      if (event.kind === 'document') {
        if (debitNote) {
          await this.debitNotes.applyDocument(debitNote.id, event.document);
        } else if (creditNote) {
          await this.creditNotes.applyDocument(creditNote.id, event.document);
        } else {
          await this.emission.applyDocument(sale!.id, event.document);
        }
      } else if (event.kind === 'despatchGuide') {
        await this.despatchGuides.applyWebhook(
          guide!.empresaId,
          event.despatchGuide,
        );
      } else if (guide) {
        await this.despatchGuides.applyVoidWebhook(
          guide.empresaId,
          event.voidRequest,
        );
      } else {
        await this.voids.apply(sale!.id, event.voidRequest);
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
type WebhookVoidRequest = BillingVoidRequest & {
  manualReference?: string | null;
  updatedAt?: string;
};

function parseEvent(payload: unknown):
  | {
      kind: 'document';
      id: string;
      type: string;
      createdAt: string;
      document: WebhookDocument;
    }
  | {
      kind: 'despatchGuide';
      id: string;
      type: string;
      createdAt: string;
      despatchGuide: BillingDespatchGuide;
    }
  | {
      kind: 'void';
      id: string;
      type: string;
      createdAt: string;
      voidRequest: WebhookVoidRequest;
    } {
  if (!payload || typeof payload !== 'object') {
    throw new BadRequestException('Webhook invalido');
  }
  const value = payload as Record<string, unknown>;
  const data = value.data as Record<string, unknown> | undefined;
  const document = data?.document as Record<string, unknown> | undefined;
  const despatchGuide = data?.despatchGuide as
    | Record<string, unknown>
    | undefined;
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
    despatchGuide &&
    typeof despatchGuide.id === 'string' &&
    typeof despatchGuide.externalId === 'string' &&
    typeof despatchGuide.environment === 'string'
  ) {
    return {
      kind: 'despatchGuide',
      id: value.id,
      type: value.type,
      createdAt: value.createdAt,
      despatchGuide: despatchGuide as unknown as BillingDespatchGuide,
    };
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
      voidRequest: voidRequest as unknown as WebhookVoidRequest,
    };
  }
  throw new BadRequestException('Payload webhook incompleto');
}

function safeEqual(expected: string, actual: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
