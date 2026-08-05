import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SunatAmbiente, SunatConfig } from '@prisma/client';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { UpdateSunatConfigDto } from './dto/update-sunat-config.dto';
import { UploadSunatCertificateDto } from './dto/upload-sunat-certificate.dto';
import { assertSunatEnvironmentAllowed } from '../plans/sunat-plan-access';

const MAX_CERTIFICATE_SIZE_BYTES = 2 * 1024 * 1024;

@Injectable()
export class SunatConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretsCryptoService: SecretsCryptoService,
    private readonly r2StorageService: R2StorageService,
  ) {}

  async findOne(empresaId: bigint) {
    const config = await this.prisma.sunatConfig.findUnique({
      where: { empresaId },
    });

    return this.toResponse(config);
  }

  async update(empresaId: bigint, dto: UpdateSunatConfigDto) {
    const company = await this.ensureCompanyExists(empresaId);

    if (dto.ambiente === SunatAmbiente.PRODUCCION) {
      assertSunatEnvironmentAllowed(company.planCodigo, dto.ambiente);
    }

    const data: Prisma.SunatConfigUncheckedUpdateInput = {};

    if (dto.ambiente !== undefined) {
      data.ambiente = dto.ambiente;
    }

    if (dto.usuarioSol !== undefined) {
      data.usuarioSolEncrypted = this.encryptOptional(dto.usuarioSol);
    }

    if (dto.claveSol !== undefined) {
      data.claveSolEncrypted = this.encryptOptional(dto.claveSol);
    }

    if (dto.clientId !== undefined) {
      data.clientIdEncrypted = this.encryptOptional(dto.clientId);
    }

    if (dto.clientSecret !== undefined) {
      data.clientSecretEncrypted = this.encryptOptional(dto.clientSecret);
    }

    if (dto.igvPorcentaje !== undefined) {
      data.igvPorcentaje = this.parseIgv(dto.igvPorcentaje);
    }

    if (dto.activo !== undefined) {
      data.activo = dto.activo;
    }

    const updated = await this.prisma.sunatConfig.upsert({
      where: { empresaId },
      create: {
        ...(data as Prisma.SunatConfigUncheckedCreateInput),
        empresaId,
      },
      update: data,
    });

    return this.toResponse(updated);
  }

  async uploadCertificate(
    empresaId: bigint,
    dto: UploadSunatCertificateDto,
    file: Express.Multer.File,
  ) {
    await this.ensureCompanyExists(empresaId);
    this.validateCertificate(file);
    const certificatePassword = dto.certificatePassword.trim();

    if (!certificatePassword) {
      throw new BadRequestException(
        'La contrasena del certificado es obligatoria',
      );
    }

    const current = await this.prisma.sunatConfig.findUnique({
      where: { empresaId },
      select: { certificadoR2Key: true },
    });
    const uploaded = await this.r2StorageService.uploadSunatCertificate({
      empresaId,
      file,
    });

    try {
      const updated = await this.prisma.sunatConfig.upsert({
        where: { empresaId },
        create: {
          empresaId,
          certificadoPasswordEncrypted:
            this.secretsCryptoService.encrypt(certificatePassword),
          certificadoR2Key: uploaded.r2Key,
          certificadoNombre: uploaded.nombre,
          certificadoMimeType: uploaded.mimeType,
          certificadoSizeBytes: uploaded.sizeBytes,
          certificadoUploadedAt: new Date(),
        },
        update: {
          certificadoPasswordEncrypted:
            this.secretsCryptoService.encrypt(certificatePassword),
          certificadoR2Key: uploaded.r2Key,
          certificadoNombre: uploaded.nombre,
          certificadoMimeType: uploaded.mimeType,
          certificadoSizeBytes: uploaded.sizeBytes,
          certificadoUploadedAt: new Date(),
        },
      });

      await this.r2StorageService.deleteSunatCertificate(
        current?.certificadoR2Key,
      );

      return this.toResponse(updated);
    } catch (error) {
      await this.r2StorageService.deleteSunatCertificate(uploaded.r2Key);
      throw error;
    }
  }

  async deleteCertificate(empresaId: bigint) {
    const current = await this.prisma.sunatConfig.findUnique({
      where: { empresaId },
    });

    if (!current) {
      throw new NotFoundException('Configuracion SUNAT no encontrada');
    }

    await this.r2StorageService.deleteSunatCertificate(
      current.certificadoR2Key,
    );

    const updated = await this.prisma.sunatConfig.update({
      where: { empresaId },
      data: {
        certificadoPasswordEncrypted: null,
        certificadoR2Key: null,
        certificadoNombre: null,
        certificadoMimeType: null,
        certificadoSizeBytes: null,
        certificadoUploadedAt: null,
      },
    });

    return this.toResponse(updated);
  }

  private async ensureCompanyExists(empresaId: bigint) {
    const company = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, planCodigo: true },
    });

    if (!company) {
      throw new NotFoundException('Empresa no encontrada');
    }

    return company;
  }

  private encryptOptional(value: string) {
    const normalized = value.trim();

    if (!normalized) {
      return null;
    }

    return this.secretsCryptoService.encrypt(normalized);
  }

  private parseIgv(value: string) {
    const normalized = value.trim();
    const parsed = Number(normalized);

    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      throw new BadRequestException(
        'El porcentaje de IGV debe estar entre 0 y 100',
      );
    }

    return new Prisma.Decimal(normalized);
  }

  private validateCertificate(file: Express.Multer.File) {
    if (file.size > MAX_CERTIFICATE_SIZE_BYTES) {
      throw new BadRequestException('El certificado no debe superar los 2MB');
    }

    const extension = file.originalname.split('.').pop()?.toLowerCase();

    if (extension !== 'pfx' && extension !== 'p12') {
      throw new BadRequestException(
        'Solo se permiten certificados .pfx o .p12',
      );
    }
  }

  private toResponse(config: SunatConfig | null) {
    if (!config) {
      return {
        ambiente: 'BETA',
        igvPorcentaje: '18.00',
        activo: false,
        usuarioSolConfigurado: false,
        claveSolConfigurada: false,
        clientIdConfigurado: false,
        clientSecretConfigurado: false,
        certificadoConfigurado: false,
        certificado: null,
      };
    }

    return {
      id: config.id.toString(),
      empresaId: config.empresaId.toString(),
      ambiente: config.ambiente,
      igvPorcentaje: config.igvPorcentaje.toFixed(2),
      activo: config.activo,
      usuarioSolConfigurado: Boolean(config.usuarioSolEncrypted),
      claveSolConfigurada: Boolean(config.claveSolEncrypted),
      clientIdConfigurado: Boolean(config.clientIdEncrypted),
      clientSecretConfigurado: Boolean(config.clientSecretEncrypted),
      certificadoConfigurado: Boolean(config.certificadoR2Key),
      certificado: config.certificadoR2Key
        ? {
            nombre: config.certificadoNombre,
            mimeType: config.certificadoMimeType,
            sizeBytes: config.certificadoSizeBytes,
            uploadedAt: config.certificadoUploadedAt,
          }
        : null,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }
}
