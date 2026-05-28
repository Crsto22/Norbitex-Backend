import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Prisma } from '@prisma/client';
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
        tipoNegocio: true,
        categoriasProducto: true,
        razonSocial: true,
        ruc: true,
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
      tipoNegocio: empresa.tipoNegocio,
      categoriasProducto: empresa.categoriasProducto,
      razonSocial: empresa.razonSocial,
      ruc: empresa.ruc,
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

  async update(empresaId: bigint, dto: UpdateCompanyDto) {
    const updateData: Prisma.EmpresaUpdateInput = {};

    if (dto.nombreComercial !== undefined) {
      const trimmed = dto.nombreComercial.trim();
      if (!trimmed) {
        throw new BadRequestException('El nombre comercial es obligatorio');
      }
      updateData.nombreComercial = trimmed;
    }

    if (dto.tipoNegocio !== undefined) {
      updateData.tipoNegocio = dto.tipoNegocio.trim() || null;
    }

    if (dto.categoriasProducto !== undefined) {
      updateData.categoriasProducto = dto.categoriasProducto;
    }

    if (dto.razonSocial !== undefined) {
      updateData.razonSocial = dto.razonSocial.trim() || null;
    }

    if (dto.ruc !== undefined) {
      const trimmedRuc = dto.ruc.trim();
      if (trimmedRuc) {
        const existing = await this.prisma.empresa.findFirst({
          where: {
            ruc: trimmedRuc,
            id: { not: empresaId },
          },
          select: { id: true },
        });
        if (existing) {
          throw new BadRequestException('El RUC ya esta registrado');
        }
      }
      updateData.ruc = trimmedRuc || null;
    }

    if (dto.telefono !== undefined) {
      updateData.telefono = dto.telefono.trim() || null;
    }

    if (dto.email !== undefined) {
      const trimmedEmail = dto.email.trim();
      if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
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

    const updated = await this.prisma.empresa.update({
      where: { id: empresaId },
      data: updateData,
      select: {
        id: true,
        nombreComercial: true,
        tipoNegocio: true,
        categoriasProducto: true,
        razonSocial: true,
        ruc: true,
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
      tipoNegocio: updated.tipoNegocio,
      categoriasProducto: updated.categoriasProducto,
      razonSocial: updated.razonSocial,
      ruc: updated.ruc,
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
        tipoNegocio: true,
        categoriasProducto: true,
        razonSocial: true,
        ruc: true,
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
      tipoNegocio: updated.tipoNegocio,
      categoriasProducto: updated.categoriasProducto,
      razonSocial: updated.razonSocial,
      ruc: updated.ruc,
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
