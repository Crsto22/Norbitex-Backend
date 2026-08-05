import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsultaDocumentoTipo } from '@prisma/client';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PlansService } from '../plans/plans.service';

type SunatConsultaResponse = {
  error?: string;
  lista?: Array<Record<string, unknown> | null>;
};

type NombrePersona = {
  nombres: string | null;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
};

type ApellidosPersona = {
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
};

const DEFAULT_SUNAT_CONSULTA_BASE_URL =
  'https://ww1.sunat.gob.pe/ol-ti-itfisdenreg/itfisdenreg.htm';
const APELLIDO_CONNECTORS = new Set([
  'DA',
  'DAS',
  'DE',
  'DEL',
  'DI',
  'DO',
  'DOS',
  'LA',
  'LAS',
  'LOS',
  'MAC',
  'MC',
  'SAN',
  'SANTA',
  'VAN',
  'VON',
]);

@Injectable()
export class DocumentoConsultaService {
  constructor(
    private readonly configService: ConfigService,
    private readonly plansService: PlansService,
  ) {}

  async consultarDni(user: JwtPayload, dni: string) {
    const valor = this.validarDocumento(dni, 8, 'DNI');
    const node = await this.consultar('obtenerDatosDni', 'numDocumento', valor);
    const item = this.extraerPrimerResultado(node, 'DNI', valor);
    const nombresApellidos = this.limpiarTexto(
      this.asString(item.nombresapellidos),
    );

    if (!nombresApellidos) {
      throw new BadRequestException(
        `No se pudo obtener informacion para el DNI ${valor}`,
      );
    }

    const nombrePersona = this.parsearNombrePersona(nombresApellidos);
    await this.registrarConsulta(user, ConsultaDocumentoTipo.dni);

    return {
      success: true,
      dni: valor,
      nombres: nombrePersona.nombres,
      apellidoPaterno: nombrePersona.apellidoPaterno,
      apellidoMaterno: nombrePersona.apellidoMaterno,
      codVerifica: null,
      codVerificaLetra: null,
    };
  }

  async consultarRuc(user: JwtPayload, ruc: string) {
    const valor = this.validarDocumento(ruc, 11, 'RUC');
    const node = await this.consultar('obtenerDatosRuc', 'nroRuc', valor);
    const item = this.extraerPrimerResultado(node, 'RUC', valor);
    const razonSocial = this.limpiarTexto(this.asString(item.apenomdenunciado));

    if (!razonSocial) {
      throw new BadRequestException(
        `No se pudo obtener informacion para el RUC ${valor}`,
      );
    }

    const idDepartamento = this.limpiarTexto(
      this.asString(item.iddepartamento),
    );
    const idProvincia = this.limpiarTexto(this.asString(item.idprovincia));
    const idDistrito = this.limpiarTexto(this.asString(item.iddistrito));
    await this.registrarConsulta(user, ConsultaDocumentoTipo.ruc);

    return {
      ruc: valor,
      razonSocial,
      nombreComercial: null,
      telefonos: [],
      tipo: null,
      estado: null,
      condicion: null,
      direccion: this.limpiarTexto(this.asString(item.direstablecimiento)),
      departamento: this.limpiarTexto(this.asString(item.desdepartamento)),
      provincia: this.limpiarTexto(this.asString(item.desprovincia)),
      distrito: this.limpiarTexto(this.asString(item.desdistrito)),
      ubigeo: this.construirUbigeo(idDepartamento, idProvincia, idDistrito),
      capital: null,
    };
  }

  private registrarConsulta(user: JwtPayload, tipo: ConsultaDocumentoTipo) {
    if (!user.empresaId) {
      throw new ForbiddenException('La consulta requiere una empresa activa');
    }

    return this.plansService.recordDocumentQuery(
      BigInt(user.empresaId),
      BigInt(user.sub),
      tipo,
    );
  }

  private async consultar(
    accion: string,
    nombreParametro: string,
    numeroDocumento: string,
  ) {
    const url = new URL(this.getBaseUrl());
    url.searchParams.set('accion', accion);
    url.searchParams.set(nombreParametro, numeroDocumento);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const body = await response.text();

      if (!response.ok) {
        throw new BadRequestException(
          `Error consultando SUNAT (HTTP ${response.status}): ${this.limitarTexto(body, 200)}`,
        );
      }

      const node = JSON.parse(body) as SunatConsultaResponse;
      const mensajeError = this.limpiarTexto(node.error);

      if (mensajeError) {
        throw new BadRequestException(mensajeError);
      }

      return node;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'La consulta a SUNAT excedio el tiempo limite'
          : error instanceof Error
            ? error.message
            : String(error);

      throw new BadRequestException(
        `No se pudo consultar el documento: ${message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private validarDocumento(valor: string, longitud: number, etiqueta: string) {
    if (!valor?.trim()) {
      throw new BadRequestException(`Ingrese ${etiqueta}`);
    }

    const limpio = valor.trim();

    if (limpio.length !== longitud || !/^\d+$/.test(limpio)) {
      throw new BadRequestException(`${etiqueta} invalido`);
    }

    return limpio;
  }

  private extraerPrimerResultado(
    node: SunatConsultaResponse,
    etiqueta: string,
    numeroDocumento: string,
  ) {
    const item = node.lista?.[0];

    if (!item) {
      throw new BadRequestException(
        `No se pudo obtener informacion para el ${etiqueta} ${numeroDocumento}`,
      );
    }

    return item;
  }

  private parsearNombrePersona(nombresApellidos: string): NombrePersona {
    const [apellidosRaw, nombresRaw] = nombresApellidos.split(',', 2);
    const apellidos = this.limpiarTexto(apellidosRaw);
    const nombres = this.limpiarTexto(nombresRaw);

    if (!apellidos) {
      return { nombres, apellidoPaterno: null, apellidoMaterno: null };
    }

    if (!nombres) {
      return {
        nombres: apellidos,
        apellidoPaterno: null,
        apellidoMaterno: null,
      };
    }

    const apellidosPersona = this.separarApellidos(apellidos);

    return {
      nombres,
      apellidoPaterno: apellidosPersona.apellidoPaterno,
      apellidoMaterno: apellidosPersona.apellidoMaterno,
    };
  }

  private separarApellidos(apellidosCompletos: string): ApellidosPersona {
    const normalizado = this.limpiarTexto(apellidosCompletos);

    if (!normalizado) {
      return { apellidoPaterno: null, apellidoMaterno: null };
    }

    const tokens = normalizado.split(' ');

    if (tokens.length === 1) {
      return { apellidoPaterno: normalizado, apellidoMaterno: null };
    }

    let inicioApellidoMaterno = tokens.length - 1;

    while (
      inicioApellidoMaterno > 0 &&
      this.esConectorApellido(tokens[inicioApellidoMaterno - 1])
    ) {
      inicioApellidoMaterno -= 1;
    }

    const apellidoPaterno = this.unirTokens(tokens, 0, inicioApellidoMaterno);
    const apellidoMaterno = this.unirTokens(
      tokens,
      inicioApellidoMaterno,
      tokens.length,
    );

    if (!apellidoPaterno) {
      return { apellidoPaterno: apellidoMaterno, apellidoMaterno: null };
    }

    return { apellidoPaterno, apellidoMaterno };
  }

  private esConectorApellido(token: string) {
    return APELLIDO_CONNECTORS.has(token.toUpperCase());
  }

  private unirTokens(tokens: string[], inicio: number, fin: number) {
    if (inicio < 0 || fin > tokens.length || inicio >= fin) {
      return null;
    }

    return this.limpiarTexto(tokens.slice(inicio, fin).join(' '));
  }

  private construirUbigeo(
    idDepartamento: string | null,
    idProvincia: string | null,
    idDistrito: string | null,
  ) {
    if (
      this.esCodigoUbigeo(idDepartamento) &&
      this.esCodigoUbigeo(idProvincia) &&
      this.esCodigoUbigeo(idDistrito)
    ) {
      return `${idDepartamento}${idProvincia}${idDistrito}`;
    }

    return null;
  }

  private esCodigoUbigeo(valor: string | null): valor is string {
    return !!valor && /^\d{2}$/.test(valor);
  }

  private limpiarTexto(valor: string | null | undefined) {
    const limpio = valor?.trim().replace(/\s+/g, ' ');
    return limpio || null;
  }

  private limitarTexto(valor: string, maxLen: number) {
    return valor.length > maxLen ? `${valor.slice(0, maxLen)}...` : valor;
  }

  private asString(value: unknown) {
    return typeof value === 'string' ? value : null;
  }

  private getBaseUrl() {
    return (
      this.configService.get<string>('SUNAT_CONSULTA_BASE_URL')?.trim() ||
      DEFAULT_SUNAT_CONSULTA_BASE_URL
    );
  }
}
