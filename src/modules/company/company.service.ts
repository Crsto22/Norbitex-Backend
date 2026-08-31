import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SucursalTipo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalPdfLogoStorageService } from '../storage/local-pdf-logo-storage.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2StorageService: R2StorageService,
    private readonly localPdfLogoStorageService: LocalPdfLogoStorageService,
  ) {}

  async findOne(empresaId: bigint) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        nombreComercial: true,
        razonSocial: true,
        ruc: true,
        dni: true,
        telefono: true,
        email: true,
        direccion: true,
        logoUrl: true,
        logoPdfUrl: true,
        comoConocio: true,
        comoConocioOtro: true,
        estado: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!empresa) {
      throw new NotFoundException('Empresa no encontrada');
    }

    return {
      id: empresa.id.toString(),
      nombreComercial: empresa.nombreComercial,
      razonSocial: empresa.razonSocial,
      ruc: empresa.ruc,
      dni: empresa.dni,
      telefono: empresa.telefono,
      email: empresa.email,
      direccion: empresa.direccion,
      logoUrl: empresa.logoUrl,
      logoPdfUrl: empresa.logoPdfUrl,
      comoConocio: empresa.comoConocio,
      comoConocioOtro: empresa.comoConocioOtro,
      estado: empresa.estado,
      createdAt: empresa.createdAt,
      updatedAt: empresa.updatedAt,
    };
  }

  async getSetupStatus(empresaId: bigint) {
    const [activeStoreBranches, activeAttendanceBranches, activeBranches] =
      await Promise.all([
        this.prisma.sucursal.count({
          where: {
            empresaId,
            estado: 'activo',
            tipo: SucursalTipo.tienda,
          },
        }),
        this.prisma.sucursal.count({
          where: {
            empresaId,
            estado: 'activo',
            tipo: SucursalTipo.asistencia,
          },
        }),
        this.prisma.sucursal.count({
          where: {
            empresaId,
            estado: 'activo',
          },
        }),
      ]);

    return {
      hasActiveBranch: activeStoreBranches > 0,
      hasActiveAttendanceBranch: activeAttendanceBranches > 0,
      hasAnyActiveBranch: activeBranches > 0,
      requiresBranch: activeStoreBranches === 0,
    };
  }

  async update(empresaId: bigint, dto: UpdateCompanyDto) {
    const updated = await this.prisma
      .$transaction(
        async (tx) => {
          const current = await tx.empresa.findUnique({
            where: { id: empresaId },
            select: { dni: true, ruc: true },
          });
          if (!current) {
            throw new NotFoundException('Empresa no encontrada');
          }

          const updateData: Prisma.EmpresaUpdateInput = {};

          if (dto.nombreComercial !== undefined) {
            const trimmed = dto.nombreComercial.trim();
            if (!trimmed) {
              throw new BadRequestException(
                'El nombre comercial es obligatorio',
              );
            }
            updateData.nombreComercial = trimmed;
          }

          if (dto.razonSocial !== undefined) {
            updateData.razonSocial = dto.razonSocial.trim() || null;
          }

          if (dto.ruc !== undefined) {
            const trimmedRuc = dto.ruc.trim();
            if (current.dni && !current.ruc) {
              const razonSocial = dto.razonSocial?.trim();
              if (!razonSocial) {
                throw new BadRequestException(
                  'La razon social es obligatoria para cambiar de DNI a RUC',
                );
              }
              updateData.dni = null;
              updateData.razonSocial = razonSocial;
            }
            updateData.ruc = trimmedRuc;
          }

          if (dto.telefono !== undefined) {
            updateData.telefono = dto.telefono.trim() || null;
          }

          if (dto.email !== undefined) {
            const trimmedEmail = dto.email.trim();
            if (
              trimmedEmail &&
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
            ) {
              throw new BadRequestException('El email no es valido');
            }
            updateData.email = trimmedEmail || null;
          }

          if (dto.direccion !== undefined) {
            updateData.direccion = dto.direccion.trim() || null;
          }

          if (dto.comoConocio !== undefined) {
            updateData.comoConocio = dto.comoConocio;
          }

          if (dto.comoConocioOtro !== undefined) {
            updateData.comoConocioOtro = dto.comoConocioOtro.trim() || null;
          }

          return tx.empresa.update({
            where: { id: empresaId },
            data: updateData,
            select: {
              id: true,
              nombreComercial: true,
              razonSocial: true,
              ruc: true,
              dni: true,
              telefono: true,
              email: true,
              direccion: true,
              logoUrl: true,
              logoPdfUrl: true,
              comoConocio: true,
              comoConocioOtro: true,
              estado: true,
              createdAt: true,
              updatedAt: true,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new BadRequestException('El RUC ya esta registrado');
        }
        throw error;
      });

    return {
      id: updated.id.toString(),
      nombreComercial: updated.nombreComercial,
      razonSocial: updated.razonSocial,
      ruc: updated.ruc,
      dni: updated.dni,
      telefono: updated.telefono,
      email: updated.email,
      direccion: updated.direccion,
      logoUrl: updated.logoUrl,
      logoPdfUrl: updated.logoPdfUrl,
      comoConocio: updated.comoConocio,
      comoConocioOtro: updated.comoConocioOtro,
      estado: updated.estado,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async uploadLogo(empresaId: bigint, file: Express.Multer.File) {
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Solo se permiten imagenes');
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('La imagen no debe superar los 5MB');
    }

    const current = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { logoPdfUrl: true },
    });

    const uploaded = await this.r2StorageService.uploadCompanyLogo({
      empresaId,
      file,
    });
    const pdfLogo = await this.localPdfLogoStorageService.saveCompanyLogo({
      empresaId,
      buffer: file.buffer,
      previousUrl: current?.logoPdfUrl,
    });

    const updated = await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { logoUrl: uploaded.urlWebp, logoPdfUrl: pdfLogo.url },
      select: {
        id: true,
        nombreComercial: true,
        razonSocial: true,
        ruc: true,
        dni: true,
        telefono: true,
        email: true,
        direccion: true,
        logoUrl: true,
        logoPdfUrl: true,
        comoConocio: true,
        comoConocioOtro: true,
        estado: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      id: updated.id.toString(),
      nombreComercial: updated.nombreComercial,
      razonSocial: updated.razonSocial,
      ruc: updated.ruc,
      dni: updated.dni,
      telefono: updated.telefono,
      email: updated.email,
      direccion: updated.direccion,
      logoUrl: updated.logoUrl,
      logoPdfUrl: updated.logoPdfUrl,
      comoConocio: updated.comoConocio,
      comoConocioOtro: updated.comoConocioOtro,
      estado: updated.estado,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
