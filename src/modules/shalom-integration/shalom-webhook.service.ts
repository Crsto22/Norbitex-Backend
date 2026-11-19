import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { ShalomIntegrationService } from './shalom-integration.service';
import { ShalomRegistrationService } from './shalom-registration.service';
import { toEstadoLogistico, type ShalomRemoteStatus } from './shalom-status';

type WebhookBody = {
  event?: string;
  data?: {
    externalRef?: string | null;
    orderId?: string;
    orden?: string;
    codigo?: string | null;
    monto?: number | null;
    status?: string;
    label?: string;
    progress?: number;
  };
};

@Injectable()
export class ShalomWebhookService {
  private readonly logger = new Logger(ShalomWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integration: ShalomIntegrationService,
    private readonly registration: ShalomRegistrationService,
  ) {}

  async receive(params: { rawBody: Buffer; signature?: string; payload: unknown }) {
    if (!params.signature) {
      throw new UnauthorizedException('Falta X-Shalom-Signature');
    }

    const body = (params.payload ?? safeParse(params.rawBody)) as WebhookBody;
    const externalRef = body.data?.externalRef;
    if (!externalRef) {
      return { ok: true, ignored: 'sin externalRef' };
    }

    const envio = await this.prisma.ventaEnvio.findFirst({
      where: { codigoPublico: externalRef },
      include: { venta: true },
    });
    if (!envio) {
      this.logger.warn(`Webhook Shalom para envio desconocido: ${externalRef}`);
      return { ok: true, ignored: 'envio no encontrado' };
    }

    const empresaId = envio.venta.empresaId;
    const credentials = await this.integration.requireCredentials(empresaId);
    if (!credentials.webhookSecret) {
      throw new UnauthorizedException('La empresa no tiene secreto de webhook configurado');
    }

    if (
      !verifySignature(credentials.webhookSecret, params.signature, params.rawBody.toString('utf8'))
    ) {
      throw new UnauthorizedException('Firma de webhook invalida');
    }

    if (body.event === 'order.registered' && body.data?.orden) {
      await this.registration.applyRegistration(envio.id, {
        orden: body.data.orden,
        codigo: body.data.codigo ?? null,
        monto: body.data.monto ?? null,
        estado: 'REGISTRADO',
      });
      await this.integration.markSynced(empresaId);
      return { ok: true, applied: 'order.registered' };
    }

    if (body.event === 'order.status_changed' && body.data?.status) {
      const remote = {
        status: body.data.status as ShalomRemoteStatus,
        label: body.data.label ?? body.data.status,
        progress: body.data.progress ?? 0,
      };
      await this.registration.applyTrackingStatus(
        envio.id,
        remote,
        toEstadoLogistico(remote.status),
      );
      await this.integration.markSynced(empresaId);
      return { ok: true, applied: 'order.status_changed' };
    }

    return { ok: true, ignored: 'evento no soportado' };
  }
}

function safeParse(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    throw new BadRequestException('Cuerpo de webhook invalido');
  }
}

/** Verifica `t=<unix>,v1=<hmac_sha256(secret, "t.body")>` con tolerancia de 5 min. */
function verifySignature(secret: string, header: string, body: string): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key?.trim(), value?.trim()];
    }),
  ) as Record<string, string | undefined>;

  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!Number.isFinite(timestamp) || !signature) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}
