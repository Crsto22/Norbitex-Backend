import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AgenciaCourierProveedor,
  AgenciaCourierSincronizacionEstado,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FindCourierAgenciesDto } from './dto/courier-agencies.dto';

type JsonRecord = Record<string, unknown>;
const searchableAgencyFields = [
  'nombre',
  'direccion',
  'departamento',
  'provincia',
  'distrito',
] as const;

type NormalizedAgency = {
  externalId: string;
  nombre: string;
  tipoSede: string | null;
  direccion: string | null;
  referencia: string | null;
  telefono: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  ubigeo: string | null;
  latitud: number | null;
  longitud: number | null;
  horario: Prisma.InputJsonValue | Prisma.NullTypes.JsonNull;
  servicios: Prisma.InputJsonValue | Prisma.NullTypes.JsonNull;
  fuenteActualizadaAt: Date | null;
  rawData: Prisma.InputJsonValue;
};

@Injectable()
export class CourierAgenciesService {
  private readonly logger = new Logger(CourierAgenciesService.name);
  private readonly running = new Set<AgenciaCourierProveedor>();

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 15 3 * * *', { timeZone: 'America/Lima' })
  async syncDaily() {
    const results = await Promise.allSettled([
      this.sync(AgenciaCourierProveedor.SHALOM),
      this.sync(AgenciaCourierProveedor.OLVA),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(
          `Sincronizacion diaria de agencias: ${message(result.reason)}`,
        );
      }
    }
  }

  async syncAll() {
    const results = await Promise.allSettled([
      this.sync(AgenciaCourierProveedor.SHALOM),
      this.sync(AgenciaCourierProveedor.OLVA),
    ]);
    return results.map((result, index) => ({
      courier:
        index === 0
          ? AgenciaCourierProveedor.SHALOM
          : AgenciaCourierProveedor.OLVA,
      ...(result.status === 'fulfilled'
        ? { ok: true, ...result.value }
        : { ok: false, error: message(result.reason) }),
    }));
  }

  async sync(courier: AgenciaCourierProveedor) {
    if (this.running.has(courier)) {
      throw new ConflictException(
        `Ya existe una sincronizacion de ${courier} en curso`,
      );
    }
    this.running.add(courier);
    const execution = await this.prisma.agenciaCourierSincronizacion.create({
      data: { courier, estado: AgenciaCourierSincronizacionEstado.procesando },
    });

    try {
      const agencies = await this.fetchAgencies(courier);
      if (!agencies.length)
        throw new ServiceUnavailableException(
          `El catalogo de ${courier} llego vacio`,
        );

      const existing = await this.prisma.agenciaCourier.findMany({
        where: { courier },
        select: { externalId: true },
      });
      const known = new Set(existing.map((item) => item.externalId));
      const seen = new Set(agencies.map((agency) => agency.externalId));
      const now = new Date();
      let created = 0;
      let updated = 0;

      await this.prisma.$transaction(async (tx) => {
        for (const agency of agencies) {
          if (known.has(agency.externalId)) updated += 1;
          else created += 1;
          await tx.agenciaCourier.upsert({
            where: {
              courier_externalId: { courier, externalId: agency.externalId },
            },
            create: { courier, ...agency, activo: true, sincronizadoAt: now },
            update: { ...agency, activo: true, sincronizadoAt: now },
          });
        }
      });

      const deactivated = await this.prisma.agenciaCourier.updateMany({
        where: { courier, activo: true, externalId: { notIn: [...seen] } },
        data: { activo: false },
      });
      const summary = {
        totalRecibidas: agencies.length,
        creadas: created,
        actualizadas: updated,
        desactivadas: deactivated.count,
      };
      await this.prisma.agenciaCourierSincronizacion.update({
        where: { id: execution.id },
        data: {
          estado: AgenciaCourierSincronizacionEstado.completada,
          finalizadaAt: new Date(),
          ...summary,
        },
      });
      return summary;
    } catch (error) {
      const detail = message(error);
      await this.prisma.agenciaCourierSincronizacion.update({
        where: { id: execution.id },
        data: {
          estado: AgenciaCourierSincronizacionEstado.fallida,
          finalizadaAt: new Date(),
          error: detail,
        },
      });
      throw error;
    } finally {
      this.running.delete(courier);
    }
  }

  async latestSyncStatus() {
    const rows = await this.prisma.agenciaCourierSincronizacion.findMany({
      orderBy: { iniciadaAt: 'desc' },
      take: 20,
    });
    return Object.values(AgenciaCourierProveedor).map((courier) => {
      const row = rows.find((item) => item.courier === courier);
      return row
        ? {
            courier: row.courier,
            estado: row.estado,
            iniciadaAt: row.iniciadaAt.toISOString(),
            finalizadaAt: row.finalizadaAt?.toISOString() ?? null,
            totalRecibidas: row.totalRecibidas,
            creadas: row.creadas,
            actualizadas: row.actualizadas,
            desactivadas: row.desactivadas,
            error: row.error,
          }
        : null;
    });
  }

  async findAll(query: FindCourierAgenciesDto) {
    const where: Prisma.AgenciaCourierWhereInput = {
      ...(query.courier ? { courier: query.courier } : {}),
      ...(query.activo === undefined
        ? { activo: true }
        : { activo: query.activo }),
      ...(query.ubigeo ? { ubigeo: query.ubigeo.trim() } : {}),
      ...(query.departamento
        ? {
            departamento: {
              equals: query.departamento.trim(),
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.provincia
        ? { provincia: { equals: query.provincia.trim(), mode: 'insensitive' } }
        : {}),
      ...(query.distrito
        ? { distrito: { equals: query.distrito.trim(), mode: 'insensitive' } }
        : {}),
      ...(query.q?.trim() ? agencyTextSearch(query.q) : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.agenciaCourier.findMany({
        where,
        orderBy: [
          { courier: 'asc' },
          { departamento: 'asc' },
          { provincia: 'asc' },
          { nombre: 'asc' },
        ],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.agenciaCourier.count({ where }),
    ]);
    return {
      data,
      pagination: {
        page: query.page,
        perPage: query.perPage,
        total,
        totalPages: Math.ceil(total / query.perPage),
      },
    };
  }

  async search(courier: AgenciaCourierProveedor, term: string, take = 20) {
    return this.prisma.agenciaCourier.findMany({
      where: {
        courier,
        activo: true,
        ...agencyTextSearch(term),
      },
      select: {
        externalId: true,
        nombre: true,
        direccion: true,
        departamento: true,
        provincia: true,
        distrito: true,
        ubigeo: true,
        latitud: true,
        longitud: true,
      },
      orderBy: [
        { departamento: 'asc' },
        { provincia: 'asc' },
        { nombre: 'asc' },
      ],
      take,
    });
  }

  private async fetchAgencies(courier: AgenciaCourierProveedor) {
    if (courier === AgenciaCourierProveedor.SHALOM) {
      const payload = await this.fetchJson<{
        success?: boolean;
        data?: JsonRecord[];
      }>('https://api.shalom-api.lat/public/agencies');
      if (!payload.success || !Array.isArray(payload.data)) {
        throw new ServiceUnavailableException(
          'Respuesta invalida del catalogo Shalom',
        );
      }
      return payload.data.map((item) => this.normalizeShalom(item));
    }

    const agencies: NormalizedAgency[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const url = `https://api.tracking-peru.com/v1/agencies?carrier=olva&page=${page}&per_page=100`;
      const payload = await this.fetchJson<{
        agencies?: JsonRecord[];
        pagination?: { total_pages?: number };
      }>(url);
      if (
        !Array.isArray(payload.agencies) ||
        !payload.pagination?.total_pages
      ) {
        throw new ServiceUnavailableException(
          'Respuesta invalida del catalogo Olva',
        );
      }
      agencies.push(
        ...payload.agencies.map((item) => this.normalizeOlva(item)),
      );
      totalPages = payload.pagination.total_pages;
      page += 1;
    } while (page <= totalPages);
    return agencies;
  }

  private normalizeShalom(source: JsonRecord): NormalizedAgency {
    const horario = compactJson({
      lunesViernes: string(source.hora_atencion),
      domingo: string(source.hora_domingo),
      estado: string(source.estadoAgencia),
    });
    return {
      externalId: required(source.ter_id, 'id de agencia Shalom'),
      nombre: required(
        source.nombre ?? source.lugar_over,
        'nombre de agencia Shalom',
      ),
      tipoSede: string(source.ter_zona),
      direccion: string(source.direccion),
      referencia: string(source.referencia ?? source.ter_referencia),
      telefono: string(source.telefono),
      departamento: string(source.departamento),
      provincia: string(source.provincia),
      distrito: string(source.distrito ?? source.zona),
      ubigeo: string(source.ubi_id),
      latitud: numeric(source.latitud),
      longitud: numeric(source.longitud),
      horario,
      servicios: compactJson({ aereo: boolean(source.ter_aereo) }),
      fuenteActualizadaAt: date(source.updated_at ?? source.synced_at),
      rawData: source as Prisma.InputJsonValue,
    };
  }

  private normalizeOlva(source: JsonRecord): NormalizedAgency {
    const location = record(source.location);
    const geo = record(source.geo);
    return {
      externalId: required(source.id, 'id de agencia Olva'),
      nombre: required(source.name, 'nombre de agencia Olva'),
      tipoSede: string(source.kind_raw ?? source.kind),
      direccion: string(location.address),
      referencia: null,
      telefono: string(source.phone),
      departamento: string(location.department),
      provincia: string(location.province),
      distrito: string(location.district),
      ubigeo: string(location.ubigeo),
      latitud: numeric(geo.lat),
      longitud: numeric(geo.lng),
      horario: json(source.hours),
      servicios: json(source.services),
      fuenteActualizadaAt: date(source.synced_at),
      rawData: source as Prisma.InputJsonValue,
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await delay(attempt * 400);
      }
    }
    throw new ServiceUnavailableException(
      `No se pudo consultar el catalogo externo: ${message(lastError)}`,
    );
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
function string(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function required(value: unknown, label: string) {
  const normalized =
    string(value) ?? (typeof value === 'number' ? String(value) : null);
  if (!normalized) throw new ServiceUnavailableException(`Falta ${label}`);
  return normalized;
}
function numeric(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function boolean(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true';
}
function date(value: unknown) {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function json(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  return value === undefined || value === null ? Prisma.JsonNull : value;
}
function compactJson(
  value: JsonRecord,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  const entries = Object.entries(value).filter(([, item]) => item !== null);
  return entries.length
    ? (Object.fromEntries(entries) as Prisma.InputJsonValue)
    : Prisma.JsonNull;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function agencyTextSearch(term: string): Prisma.AgenciaCourierWhereInput {
  const terms = term.trim().split(/\s+/).filter(Boolean);
  return {
    AND: terms.map((value) => ({
      OR: searchableAgencyFields.map((field) => ({
        [field]: { contains: value, mode: 'insensitive' },
      })),
    })),
  };
}
