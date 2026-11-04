import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class BillingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(message);
  }

  get retryable() {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

@Injectable()
export class BillingApiClientService {
  constructor(private readonly config: ConfigService) {}

  admin<T>(path: string, init?: RequestInit) {
    const key = this.config.get<string>('BILLING_PLATFORM_ADMIN_KEY')?.trim();
    if (!key) {
      throw new ServiceUnavailableException(
        'BILLING_PLATFORM_ADMIN_KEY no esta configurada',
      );
    }
    return this.request<T>(path, key, init);
  }

  application<T>(path: string, apiKey: string, init?: RequestInit) {
    return this.request<T>(path, apiKey, init);
  }

  async download(url: string) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs()),
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new BillingApiError(
        `No se pudo descargar el artefacto Billing (${response.status})`,
        response.status,
        null,
      );
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType:
        response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  private async request<T>(path: string, token: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${token}`);
    headers.set('accept', 'application/json');
    if (init?.body && !(init.body instanceof FormData)) {
      headers.set('content-type', 'application/json');
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
    } catch (error) {
      throw new BillingApiError(
        error instanceof Error ? error.message : 'Billing no disponible',
        503,
        null,
      );
    }

    const text = await response.text();
    const payload = text ? safeJson(text) : null;
    if (!response.ok) {
      throw new BillingApiError(
        errorMessage(payload) ?? `Billing respondio ${response.status}`,
        response.status,
        payload,
      );
    }
    return payload as T;
  }

  private baseUrl() {
    return (
      this.config.get<string>('BILLING_API_URL')?.trim().replace(/\/$/, '') ??
      'https://billing-api.nuvex.pe/v1'
    );
  }

  private timeoutMs() {
    const value = Number(
      this.config.get<string>('BILLING_REQUEST_TIMEOUT_MS') ?? '15000',
    );
    return Number.isFinite(value) && value >= 1000 ? value : 15000;
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null;
  const message = (payload as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' ? message : null;
}
