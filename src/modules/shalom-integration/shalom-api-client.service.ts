import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class ShalomApiError extends Error {
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

/**
 * Cliente HTTP del microservicio shalom-service.
 * Sigue el mismo patron que BillingApiClientService.
 */
@Injectable()
export class ShalomApiClientService {
  constructor(private readonly config: ConfigService) {}

  registerOrder<T>(
    tenantId: string,
    apiKey: string,
    payload: unknown,
    idempotencyKey?: string,
  ) {
    return this.request<T>(`/v1/tenants/${tenantId}/orders`, apiKey, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: idempotencyKey ? { 'idempotency-key': idempotencyKey } : undefined,
    });
  }

  getJob<T>(jobId: string, apiKey: string) {
    return this.request<T>(`/v1/jobs/${jobId}`, apiKey);
  }

  getOrder<T>(orderId: string, apiKey: string) {
    return this.request<T>(`/v1/orders/${orderId}`, apiKey);
  }

  login<T>(tenantId: string, apiKey: string) {
    return this.request<T>(`/v1/sessions/${tenantId}/login`, apiKey, {
      method: 'POST',
    });
  }

  track<T>(orden: string, codigo: string | undefined, apiKey: string) {
    const query = codigo ? `?orden=${orden}&codigo=${codigo}` : `?orden=${orden}`;
    return this.request<T>(`/v1/tracking${query}`, apiKey);
  }

  // --- Administracion (SHALOM_SERVICE_ADMIN_KEY) ---

  createTenant<T>(adminKey: string, payload: unknown) {
    return this.request<T>('/v1/admin/tenants', adminKey, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  updateCredentials<T>(adminKey: string, tenantId: string, payload: unknown) {
    return this.request<T>(`/v1/admin/tenants/${tenantId}/credentials?validate=true`, adminKey, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  validateCredentials<T>(adminKey: string, tenantId: string) {
    return this.request<T>(`/v1/admin/tenants/${tenantId}/validate-credentials`, adminKey, {
      method: 'POST',
    });
  }

  createWebhook<T>(adminKey: string, applicationId: string, payload: unknown) {
    return this.request<T>(`/v1/admin/applications/${applicationId}/webhooks`, adminKey, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  listSessions<T>(adminKey: string) {
    return this.request<T>('/v1/admin/sessions', adminKey);
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
      throw new ShalomApiError(
        error instanceof Error ? error.message : 'shalom-service no disponible',
        503,
        null,
      );
    }

    const text = await response.text();
    const payload = text ? safeJson(text) : null;

    if (!response.ok) {
      throw new ShalomApiError(
        errorMessage(payload) ?? `shalom-service respondio ${response.status}`,
        response.status,
        payload,
      );
    }

    return payload as T;
  }

  private baseUrl() {
    const url = this.config.get<string>('SHALOM_SERVICE_URL')?.trim();
    if (!url) {
      throw new ServiceUnavailableException('SHALOM_SERVICE_URL no esta configurada');
    }
    return url.replace(/\/$/, '');
  }

  private timeoutMs() {
    return Number(this.config.get<string>('SHALOM_SERVICE_TIMEOUT_MS') ?? 60_000);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const message = record.message ?? record.error;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' ? message : null;
}
