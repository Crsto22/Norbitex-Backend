import { BadGatewayException, Injectable } from '@nestjs/common';
import { SunatAmbiente, SunatEndpointCodigo } from '@prisma/client';
import { createHash } from 'node:crypto';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { SunatEndpointConfigService } from '../sunat-config/sunat-endpoint-config.service';

type RestConfig = {
  id: bigint;
  ambiente: SunatAmbiente;
  ruc: string;
  usuarioSolEncrypted: string;
  claveSolEncrypted: string;
  clientIdEncrypted: string;
  clientSecretEncrypted: string;
};

type Token = { value: string; expiresAt: number };

@Injectable()
export class SunatRestApiClientService {
  private readonly tokens = new Map<string, Token>();

  constructor(
    private readonly secrets: SecretsCryptoService,
    private readonly endpoints: SunatEndpointConfigService,
  ) {}

  async sendGuide(config: RestConfig, zipName: string, zipBytes: Buffer) {
    return this.withTokenRefresh(config, async (token) => {
      const baseUrl = await this.endpoint(
        config.ambiente,
        SunatEndpointCodigo.API_CPE,
      );
      const response = await this.request(
        `${baseUrl.replace(/\/$/, '')}/${zipName.replace(/\.zip$/i, '')}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            archivo: {
              nomArchivo: zipName,
              arcGreZip: zipBytes.toString('base64'),
              hashZip: createHash('sha256').update(zipBytes).digest('hex'),
            },
          }),
        },
      );
      const body = await this.json(response);
      return {
        ticket: this.string(body.numTicket),
        code: this.string(body.codRespuesta),
      };
    });
  }

  async getTicket(config: RestConfig, ticket: string) {
    return this.withTokenRefresh(config, async (token) => {
      const baseUrl = await this.endpoint(
        config.ambiente,
        SunatEndpointCodigo.API_CPE,
      );
      const response = await this.request(
        `${baseUrl.replace(/\/$/, '')}/envios/${encodeURIComponent(ticket)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const body = await this.json(response);
      const encodedCdr = this.string(body.arcCdr);
      return {
        code: this.string(body.codRespuesta),
        generated: this.string(body.indCdrGenerado),
        cdr: encodedCdr ? Buffer.from(encodedCdr, 'base64') : null,
      };
    });
  }

  private async withTokenRefresh<T>(
    config: RestConfig,
    operation: (token: string) => Promise<T>,
  ) {
    try {
      return await operation(await this.token(config));
    } catch (error) {
      if (!this.isUnauthorized(error)) throw error;
      this.tokens.delete(config.id.toString());
      return operation(await this.token(config, true));
    }
  }

  private async token(config: RestConfig, force = false) {
    const key = config.id.toString();
    const cached = this.tokens.get(key);
    if (!force && cached && cached.expiresAt > Date.now() + 30_000) {
      return cached.value;
    }

    const clientId = this.secrets.decrypt(config.clientIdEncrypted);
    const tokenBase = await this.endpoint(
      config.ambiente,
      SunatEndpointCodigo.API_TOKEN,
    );
    const url = tokenBase.includes('/oauth2/token')
      ? tokenBase
      : `${tokenBase.replace(/\/$/, '')}/${encodeURIComponent(clientId)}/oauth2/token`;
    const usuarioSol = this.secrets.decrypt(config.usuarioSolEncrypted);
    const form = new URLSearchParams({
      grant_type: 'password',
      scope: 'https://api-cpe.sunat.gob.pe',
      client_id: clientId,
      client_secret: this.secrets.decrypt(config.clientSecretEncrypted),
      username: usuarioSol.startsWith(config.ruc)
        ? usuarioSol
        : `${config.ruc}${usuarioSol}`,
      password: this.secrets.decrypt(config.claveSolEncrypted),
    });
    const response = await this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const body = await this.json(response);
    const accessToken = this.string(body.access_token);
    if (!accessToken) {
      throw new BadGatewayException('SUNAT devolvio un token vacio');
    }
    const expiresIn = Number(body.expires_in) || 300;
    this.tokens.set(key, {
      value: accessToken,
      expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    });
    return accessToken;
  }

  private async endpoint(
    environment: SunatAmbiente,
    code: SunatEndpointCodigo,
  ) {
    const url = await this.endpoints.resolveEndpointUrl(environment, code);
    if (!url) {
      throw new BadGatewayException(
        `No existe endpoint SUNAT ${code} activo para ${environment}`,
      );
    }
    return url;
  }

  private async request(url: string, init: RequestInit) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        if (attempt === 3) throw error;
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        continue;
      }

      if (response.ok) return response;
      const body = await response.text();
      const error = new Error(
        `SUNAT HTTP ${response.status}: ${this.errorMessage(body)}`,
      );
      if (response.status < 500 || attempt === 3) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
    throw lastError;
  }

  private async json(response: Response) {
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new BadGatewayException('SUNAT devolvio una respuesta invalida');
    }
  }

  private errorMessage(body: string) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      return this.string(parsed.msg || parsed.error_description) || body;
    } catch {
      return body.slice(0, 300);
    }
  }

  private string(value: unknown) {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : '';
  }

  private isUnauthorized(error: unknown) {
    return error instanceof Error && error.message.includes('SUNAT HTTP 401');
  }
}
