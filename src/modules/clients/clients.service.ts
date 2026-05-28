import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClienteEstado, ClienteTipoDocumento, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { FindClientsQueryDto } from './dto/find-clients-query.dto';
import { UpdateClientDto } from './dto/update-client.dto';

type NormalizedClientData = {
  tipoDocumento: ClienteTipoDocumento;
  numeroDocumento: string | null;
  nombre: string | null;
  razonSocial: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  ubigeo: string | null;
  distrito: string | null;
  estado: ClienteEstado;
};

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: bigint, query: FindClientsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const where: Prisma.ClienteWhereInput = {
      empresaId,
      ...(query.tipoDocumento ? { tipoDocumento: query.tipoDocumento } : {}),
      ...(query.estado ? { estado: query.estado } : {}),
      ...(search
        ? {
            OR: [
              { numeroDocumento: { contains: search } },
              { nombre: { contains: search, mode: 'insensitive' } },
              { razonSocial: { contains: search, mode: 'insensitive' } },
              { telefono: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { direccion: { contains: search, mode: 'insensitive' } },
              { distrito: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [clients, total, activeTotal, inactiveTotal, dniTotal, rucTotal] =
      await this.prisma.$transaction([
        this.prisma.cliente.findMany({
          where,
          orderBy: [{ estado: 'asc' }, { updatedAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.cliente.count({ where }),
        this.prisma.cliente.count({
          where: { empresaId, estado: ClienteEstado.activo },
        }),
        this.prisma.cliente.count({
          where: { empresaId, estado: ClienteEstado.inactivo },
        }),
        this.prisma.cliente.count({
          where: { empresaId, tipoDocumento: ClienteTipoDocumento.dni },
        }),
        this.prisma.cliente.count({
          where: { empresaId, tipoDocumento: ClienteTipoDocumento.ruc },
        }),
      ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: clients.map((client) => this.toResponse(client)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        activeTotal,
        inactiveTotal,
        dniTotal,
        rucTotal,
      },
    };
  }

  async create(empresaId: bigint, dto: CreateClientDto) {
    const data = this.normalizeData(dto);

    try {
      const client = await this.prisma.cliente.create({
        data: {
          empresaId,
          ...data,
        },
      });

      return this.toResponse(client);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(empresaId: bigint, id: bigint, dto: UpdateClientDto) {
    const currentClient = await this.ensureClientExists(empresaId, id);
    const mergedDto = {
      tipoDocumento: dto.tipoDocumento ?? currentClient.tipoDocumento,
      numeroDocumento:
        dto.numeroDocumento !== undefined
          ? dto.numeroDocumento
          : (currentClient.numeroDocumento ?? undefined),
      nombre: dto.nombre !== undefined ? dto.nombre : (currentClient.nombre ?? undefined),
      razonSocial:
        dto.razonSocial !== undefined
          ? dto.razonSocial
          : (currentClient.razonSocial ?? undefined),
      telefono:
        dto.telefono !== undefined ? dto.telefono : (currentClient.telefono ?? undefined),
      email: dto.email !== undefined ? dto.email : (currentClient.email ?? undefined),
      direccion:
        dto.direccion !== undefined
          ? dto.direccion
          : (currentClient.direccion ?? undefined),
      ubigeo: dto.ubigeo !== undefined ? dto.ubigeo : (currentClient.ubigeo ?? undefined),
      distrito:
        dto.distrito !== undefined ? dto.distrito : (currentClient.distrito ?? undefined),
      estado: dto.estado ?? currentClient.estado,
    };
    const data = this.normalizeData(mergedDto);

    try {
      const client = await this.prisma.cliente.update({
        where: { id },
        data,
      });

      return this.toResponse(client);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(empresaId: bigint, id: bigint) {
    await this.ensureClientExists(empresaId, id);

    const client = await this.prisma.cliente.update({
      where: { id },
      data: { estado: ClienteEstado.inactivo },
    });

    return this.toResponse(client);
  }

  private async ensureClientExists(empresaId: bigint, id: bigint) {
    const client = await this.prisma.cliente.findFirst({
      where: { id, empresaId },
    });

    if (!client) {
      throw new NotFoundException('Cliente no encontrado');
    }

    return client;
  }

  private normalizeData(dto: CreateClientDto | UpdateClientDto): NormalizedClientData {
    const tipoDocumento = dto.tipoDocumento as ClienteTipoDocumento;
    const numeroDocumento =
      tipoDocumento === ClienteTipoDocumento.sin_documento
        ? null
        : this.cleanDigits(dto.numeroDocumento);
    const nombre = this.cleanOptionalText(dto.nombre);
    const razonSocial = this.cleanOptionalText(dto.razonSocial);
    const telefono = this.cleanOptionalText(dto.telefono);
    const email = this.cleanOptionalText(dto.email)?.toLowerCase() ?? null;
    const direccion = this.cleanOptionalText(dto.direccion);
    const ubigeo = this.cleanOptionalText(dto.ubigeo);
    const distrito = this.cleanOptionalText(dto.distrito);
    const estado = (dto.estado ?? ClienteEstado.activo) as ClienteEstado;

    if (tipoDocumento === ClienteTipoDocumento.dni) {
      if (!numeroDocumento || !/^\d{8}$/.test(numeroDocumento)) {
        throw new BadRequestException('El DNI debe tener 8 digitos');
      }

      if (!nombre) {
        throw new BadRequestException('El nombre es obligatorio para DNI');
      }
    }

    if (tipoDocumento === ClienteTipoDocumento.ruc) {
      if (!numeroDocumento || !/^\d{11}$/.test(numeroDocumento)) {
        throw new BadRequestException('El RUC debe tener 11 digitos');
      }

      if (!razonSocial) {
        throw new BadRequestException('La razon social es obligatoria para RUC');
      }
    }

    if (tipoDocumento === ClienteTipoDocumento.sin_documento && !nombre && !razonSocial) {
      throw new BadRequestException('Ingresa un nombre o razon social');
    }

    if ((ubigeo && !distrito) || (!ubigeo && distrito)) {
      throw new BadRequestException('Ubigeo y distrito deben enviarse juntos');
    }

    return {
      tipoDocumento,
      numeroDocumento,
      nombre,
      razonSocial,
      telefono,
      email,
      direccion,
      ubigeo,
      distrito,
      estado,
    };
  }

  private cleanOptionalText(value?: string) {
    const cleanValue = value?.trim().replace(/\s+/g, ' ');
    return cleanValue || null;
  }

  private cleanDigits(value?: string) {
    return value?.trim().replace(/\D/g, '') || null;
  }

  private getDefaultPaginationLimit() {
    const defaultLimit = Number(process.env.PAGINATION_DEFAULT_LIMIT ?? 12);
    const maxLimit = Number(process.env.PAGINATION_MAX_LIMIT ?? 100);

    if (!Number.isInteger(defaultLimit) || defaultLimit <= 0) {
      return 12;
    }

    if (!Number.isInteger(maxLimit) || maxLimit <= 0) {
      return defaultLimit;
    }

    return Math.min(defaultLimit, maxLimit);
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe un cliente con ese documento');
    }

    throw error;
  }

  private toResponse(client: {
    id: bigint;
    empresaId: bigint;
    tipoDocumento: ClienteTipoDocumento;
    numeroDocumento: string | null;
    nombre: string | null;
    razonSocial: string | null;
    telefono: string | null;
    email: string | null;
    direccion: string | null;
    ubigeo: string | null;
    distrito: string | null;
    estado: ClienteEstado;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: client.id.toString(),
      empresaId: client.empresaId.toString(),
      tipoDocumento: client.tipoDocumento,
      numeroDocumento: client.numeroDocumento,
      nombre: client.nombre,
      razonSocial: client.razonSocial,
      displayName: client.razonSocial || client.nombre || 'Cliente sin nombre',
      telefono: client.telefono,
      email: client.email,
      direccion: client.direccion,
      ubigeo: client.ubigeo,
      distrito: client.distrito,
      estado: client.estado,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }
}
