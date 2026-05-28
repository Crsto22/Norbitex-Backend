import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';

type UploadedProductImage = {
  urlOriginal: string;
  urlWebp: string;
  urlThumbnail: string;
  r2KeyOriginal: string;
  r2KeyWebp: string;
  r2KeyThumbnail: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

type UploadedCompanyLogo = {
  urlWebp: string;
  r2KeyWebp: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

type UploadedSunatCertificate = {
  r2Key: string;
  nombre: string;
  mimeType: string;
  sizeBytes: number;
};

@Injectable()
export class R2StorageService {
  private client?: S3Client;

  constructor(private readonly configService: ConfigService) {}

  async uploadCompanyLogo(params: {
    empresaId: bigint;
    file: Express.Multer.File;
  }): Promise<UploadedCompanyLogo> {
    if (!params.file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Solo se permiten imagenes');
    }

    const config = this.getR2Config();
    const imageId = randomUUID();
    const baseKey = [
      'logos',
      `empresa-${params.empresaId.toString()}`,
      imageId,
    ].join('/');
    const r2KeyWebp = `${baseKey}/logo.webp`;

    const optimized = await sharp(params.file.buffer)
      .rotate()
      .resize({
        width: 512,
        height: 512,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();

    const metadata = await sharp(params.file.buffer).metadata();

    await this.putObject(config.bucket, r2KeyWebp, optimized, 'image/webp');

    return {
      urlWebp: this.buildPublicUrl(config.publicUrl, r2KeyWebp),
      r2KeyWebp,
      mimeType: params.file.mimetype,
      sizeBytes: params.file.size,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
    };
  }

  async uploadSunatCertificate(params: {
    empresaId: bigint;
    file: Express.Multer.File;
  }): Promise<UploadedSunatCertificate> {
    const config = this.getR2BucketConfig();
    const certificateId = randomUUID();
    const extension = this.getCertificateExtension(params.file.originalname);
    const r2Key = [
      'sunat-certificates',
      `empresa-${params.empresaId.toString()}`,
      `${certificateId}.${extension}`,
    ].join('/');

    await this.putObject(
      config.bucket,
      r2Key,
      params.file.buffer,
      params.file.mimetype || 'application/octet-stream',
    );

    return {
      r2Key,
      nombre: params.file.originalname,
      mimeType: params.file.mimetype || 'application/octet-stream',
      sizeBytes: params.file.size,
    };
  }

  async deleteSunatCertificate(r2Key: string | null | undefined) {
    if (!r2Key) {
      return;
    }

    await this.deleteObject(r2Key);
  }

  async uploadProductColorImage(params: {
    empresaId: bigint;
    productoId: bigint;
    colorId: bigint;
    file: Express.Multer.File;
  }): Promise<UploadedProductImage> {
    if (!params.file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Solo se permiten imagenes');
    }

    const config = this.getR2Config();
    const imageId = randomUUID();
    const baseKey = [
      config.prefix,
      `empresa-${params.empresaId.toString()}`,
      `producto-${params.productoId.toString()}`,
      `color-${params.colorId.toString()}`,
      imageId,
    ]
      .filter(Boolean)
      .join('/');
    const originalExtension = this.getExtension(params.file.mimetype);
    const r2KeyOriginal = `${baseKey}/original.${originalExtension}`;
    const r2KeyWebp = `${baseKey}/full.webp`;
    const r2KeyThumbnail = `${baseKey}/thumb.webp`;
    const baseImage = sharp(params.file.buffer).rotate();
    const metadata = await baseImage.metadata();
    const fullImage = await baseImage
      .clone()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    const thumbnail = await baseImage
      .clone()
      .resize({
        width: 420,
        height: 420,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 74 })
      .toBuffer();

    await Promise.all([
      this.putObject(
        config.bucket,
        r2KeyOriginal,
        params.file.buffer,
        params.file.mimetype,
      ),
      this.putObject(config.bucket, r2KeyWebp, fullImage, 'image/webp'),
      this.putObject(config.bucket, r2KeyThumbnail, thumbnail, 'image/webp'),
    ]);

    return {
      urlOriginal: this.buildPublicUrl(config.publicUrl, r2KeyOriginal),
      urlWebp: this.buildPublicUrl(config.publicUrl, r2KeyWebp),
      urlThumbnail: this.buildPublicUrl(config.publicUrl, r2KeyThumbnail),
      r2KeyOriginal,
      r2KeyWebp,
      r2KeyThumbnail,
      mimeType: params.file.mimetype,
      sizeBytes: params.file.size,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
    };
  }

  async deleteProductImage(params: {
    r2KeyOriginal: string;
    r2KeyWebp: string;
    r2KeyThumbnail: string;
  }) {
    await Promise.allSettled([
      this.deleteObject(params.r2KeyOriginal),
      this.deleteObject(params.r2KeyWebp),
      this.deleteObject(params.r2KeyThumbnail),
    ]);
  }

  private async deleteObject(key: string) {
    const config = this.getR2BucketConfig();

    try {
      await this.getClient().send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: key,
        }),
      );
    } catch {
      // Silently ignore — image may have been deleted already
    }
  }

  private async putObject(
    bucket: string,
    key: string,
    body: Buffer,
    contentType: string,
  ) {
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  private getClient() {
    if (this.client) {
      return this.client;
    }

    const accountId = this.configService.get<string>(
      'CLOUDFLARE_R2_ACCOUNT_ID',
    );
    const accessKeyId = this.configService.get<string>(
      'CLOUDFLARE_R2_ACCESS_KEY_ID',
    );
    const secretAccessKey = this.configService.get<string>(
      'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    );

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new BadRequestException(
        'Configura las credenciales de Cloudflare R2 para subir imagenes',
      );
    }

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    return this.client;
  }

  private getR2Config() {
    const config = this.getR2BucketConfig();
    const publicUrl = this.configService.get<string>(
      'CLOUDFLARE_R2_PUBLIC_URL',
    );
    const prefix =
      this.configService.get<string>('CLOUDFLARE_R2_PREFIX') ?? 'products';

    if (!publicUrl) {
      throw new BadRequestException(
        'Configura la URL publica de Cloudflare R2',
      );
    }

    return {
      ...config,
      publicUrl,
      prefix: prefix.replace(/^\/+|\/+$/g, ''),
    };
  }

  private getR2BucketConfig() {
    const bucket = this.configService.get<string>('CLOUDFLARE_R2_BUCKET');

    if (!bucket) {
      throw new BadRequestException('Configura el bucket de Cloudflare R2');
    }

    return {
      bucket,
    };
  }

  private buildPublicUrl(publicUrl: string, key: string) {
    return `${publicUrl.replace(/\/+$/g, '')}/${key}`;
  }

  private getExtension(mimeType: string) {
    if (mimeType === 'image/png') {
      return 'png';
    }

    if (mimeType === 'image/webp') {
      return 'webp';
    }

    if (mimeType === 'image/gif') {
      return 'gif';
    }

    return 'jpg';
  }

  private getCertificateExtension(filename: string) {
    const extension = filename.split('.').pop()?.toLowerCase();

    if (extension === 'p12') {
      return 'p12';
    }

    return 'pfx';
  }
}
