import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type CatalogoTransporteParticipante,
  type CatalogoVehiculo,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateCatalogoParticipanteDto,
  CreateCatalogoVehiculoDto,
  FindCatalogosGuiaQueryDto,
  UpdateCatalogoParticipanteDto,
  UpdateCatalogoVehiculoDto,
} from './dto/guia-remision-catalogos.dto';

@Injectable()
export class GuiaRemisionCatalogosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findParticipantes(empresaId: bigint, query: FindCatalogosGuiaQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.q?.trim();
    const where: Prisma.CatalogoTransporteParticipanteWhereInput = {
      empresaId,
      deletedAt: null,
      ...(query.tipo ? { tipo: query.tipo } : {}),
      ...(query.activo !== undefined ? { activo: query.activo } : {}),
      ...(search
        ? {
            OR: [
              { numeroDocumento: { contains: search, mode: 'insensitive' } },
              { nombres: { contains: search, mode: 'insensitive' } },
              { apellidos: { contains: search, mode: 'insensitive' } },
              { razonSocial: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.catalogoTransporteParticipante.findMany({
        where,
        orderBy: [{ tipo: 'asc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.catalogoTransporteParticipante.count({ where }),
    ]);

    return this.paginate(
      items.map((item) => this.toParticipanteResponse(item)),
      page,
      limit,
      total,
    );
  }

  async createParticipante(
    empresaId: bigint,
    dto: CreateCatalogoParticipanteDto,
  ) {
    this.validateParticipante(dto);
    const item = await this.prisma.catalogoTransporteParticipante.create({
      data: this.toParticipanteData(empresaId, dto),
    });
    return this.toParticipanteResponse(item);
  }

  async updateParticipante(
    empresaId: bigint,
    publicId: string,
    dto: UpdateCatalogoParticipanteDto,
  ) {
    const current = await this.prisma.catalogoTransporteParticipante.findFirst({
      where: { empresaId, publicId, deletedAt: null },
    });
    if (!current) {
      throw new NotFoundException('Participante no encontrado');
    }

    this.validateParticipante(dto);
    const updated = await this.prisma.catalogoTransporteParticipante.update({
      where: { id: current.id },
      data: {
        ...this.toParticipanteData(empresaId, dto),
        activo: dto.activo ?? current.activo,
      },
    });
    return this.toParticipanteResponse(updated);
  }

  async removeParticipante(empresaId: bigint, publicId: string) {
    const current = await this.prisma.catalogoTransporteParticipante.findFirst({
      where: { empresaId, publicId, deletedAt: null },
    });
    if (!current) {
      throw new NotFoundException('Participante no encontrado');
    }

    await this.prisma.catalogoTransporteParticipante.update({
      where: { id: current.id },
      data: { activo: false, deletedAt: new Date() },
    });
    return { success: true };
  }

  async findVehiculos(empresaId: bigint, query: FindCatalogosGuiaQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.q?.trim();
    const where: Prisma.CatalogoVehiculoWhereInput = {
      empresaId,
      deletedAt: null,
      ...(query.activo !== undefined ? { activo: query.activo } : {}),
      ...(search
        ? {
            OR: [
              { placa: { contains: search, mode: 'insensitive' } },
              { marca: { contains: search, mode: 'insensitive' } },
              { modelo: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.catalogoVehiculo.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.catalogoVehiculo.count({ where }),
    ]);

    return this.paginate(
      items.map((item) => this.toVehiculoResponse(item)),
      page,
      limit,
      total,
    );
  }

  async createVehiculo(empresaId: bigint, dto: CreateCatalogoVehiculoDto) {
    const item = await this.prisma.catalogoVehiculo.create({
      data: this.toVehiculoData(empresaId, dto),
    });
    return this.toVehiculoResponse(item);
  }

  async updateVehiculo(
    empresaId: bigint,
    publicId: string,
    dto: UpdateCatalogoVehiculoDto,
  ) {
    const current = await this.prisma.catalogoVehiculo.findFirst({
      where: { empresaId, publicId, deletedAt: null },
    });
    if (!current) {
      throw new NotFoundException('Vehiculo no encontrado');
    }

    const updated = await this.prisma.catalogoVehiculo.update({
      where: { id: current.id },
      data: {
        ...this.toVehiculoData(empresaId, dto),
        activo: dto.activo ?? current.activo,
      },
    });
    return this.toVehiculoResponse(updated);
  }

  async removeVehiculo(empresaId: bigint, publicId: string) {
    const current = await this.prisma.catalogoVehiculo.findFirst({
      where: { empresaId, publicId, deletedAt: null },
    });
    if (!current) {
      throw new NotFoundException('Vehiculo no encontrado');
    }

    await this.prisma.catalogoVehiculo.update({
      where: { id: current.id },
      data: { activo: false, deletedAt: new Date() },
    });
    return { success: true };
  }

  private validateParticipante(dto: CreateCatalogoParticipanteDto) {
    if (dto.tipo === 'conductor') {
      if (!dto.nombres?.trim() || !dto.apellidos?.trim() || !dto.licencia) {
        throw new BadRequestException(
          'El conductor requiere nombres, apellidos y licencia',
        );
      }
    }

    if (dto.tipo === 'transportista') {
      if (!dto.razonSocial?.trim() || !dto.registroMtc) {
        throw new BadRequestException(
          'El transportista requiere razon social y registro MTC',
        );
      }
    }
  }

  private toParticipanteData(
    empresaId: bigint,
    dto: CreateCatalogoParticipanteDto,
  ) {
    return {
      empresaId,
      tipo: dto.tipo,
      tipoDocumento: this.clean(dto.tipoDocumento),
      numeroDocumento: this.clean(dto.numeroDocumento),
      nombres: this.optional(dto.nombres),
      apellidos: this.optional(dto.apellidos),
      razonSocial: this.optional(dto.razonSocial),
      licencia: this.optional(dto.licencia)?.toUpperCase() ?? null,
      registroMtc: this.optional(dto.registroMtc)?.toUpperCase() ?? null,
    };
  }

  private toVehiculoData(empresaId: bigint, dto: CreateCatalogoVehiculoDto) {
    return {
      empresaId,
      placa: this.clean(dto.placa).toUpperCase(),
      marca: this.optional(dto.marca),
      modelo: this.optional(dto.modelo),
    };
  }

  private toParticipanteResponse(item: CatalogoTransporteParticipante) {
    return {
      publicId: item.publicId,
      tipo: item.tipo,
      tipoDocumento: item.tipoDocumento,
      numeroDocumento: item.numeroDocumento,
      nombres: item.nombres,
      apellidos: item.apellidos,
      razonSocial: item.razonSocial,
      licencia: item.licencia,
      registroMtc: item.registroMtc,
      activo: item.activo,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private toVehiculoResponse(item: CatalogoVehiculo) {
    return {
      publicId: item.publicId,
      placa: item.placa,
      marca: item.marca,
      modelo: item.modelo,
      activo: item.activo,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private paginate<T>(data: T[], page: number, limit: number, total: number) {
    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private optional(value?: string) {
    const clean = value?.trim().replace(/\s+/g, ' ');
    return clean || null;
  }

  private clean(value: string) {
    return value.trim().replace(/\s+/g, ' ');
  }

  private getDefaultPaginationLimit() {
    const value = Number(
      this.configService.get<string>('PAGINATION_DEFAULT_LIMIT') ?? 12,
    );
    return Number.isInteger(value) && value > 0 ? value : 12;
  }
}
