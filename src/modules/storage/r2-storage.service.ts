import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SunatAmbiente } from '@prisma/client';
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

type StoredSunatDocument = {
  r2Key: string;
  nombre: string;
  mimeType: string;
  sizeBytes: number;
};

export function buildCompanySunatR2Key(params: {
  empresaId: bigint;
  ambiente: SunatAmbiente;
  tipo: string;
  fecha: Date;
  fileName: string;
}) {
  return [
    'sunat',
    `empresa-${params.empresaId.toString()}`,
    params.ambiente,
    'ventas',
    params.tipo,
    params.fecha.getFullYear().toString(),
    String(params.fecha.getMonth() + 1).padStart(2, '0'),
    sanitizeR2FileName(params.fileName),
  ].join('/');
}

export function buildPlatformSunatR2Key(params: {
  ambiente: SunatAmbiente;
  tipo: string;
  fecha: Date;
  fileName: string;
}) {
  return [
    'sunat',
    'plataforma',
    params.ambiente,
    params.tipo,
    params.fecha.getFullYear().toString(),
    String(params.fecha.getMonth() + 1).padStart(2, '0'),
    sanitizeR2FileName(params.fileName),
  ].join('/');
}

function sanitizeR2FileName(value: string) {
  return (value || 'archivo.bin').trim().replace(/[\\/:*?"<>|]/g, '-');
}

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

    const config = this.getPublicR2Config();
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
    const config = this.getPrivateR2Config();
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

  async uploadPlatformSunatCertificate(file: Express.Multer.File) {
    const config = this.getPrivateR2Config();
    const extension = this.getCertificateExtension(file.originalname);
    const r2Key = `sunat-certificates/plataforma/${randomUUID()}.${extension}`;
    await this.putObject(
      config.bucket,
      r2Key,
      file.buffer,
      file.mimetype || 'application/octet-stream',
    );
    return {
      r2Key,
      nombre: file.originalname,
      mimeType: file.mimetype || 'application/octet-stream',
      sizeBytes: file.size,
    };
  }

  async uploadPlatformSunatDocument(params: {
    ambiente: SunatAmbiente;
    tipo:
      | 'facturas'
      | 'boletas'
      | 'notas-credito'
      | 'notas-venta'
      | 'bajas-ra'
      | 'bajas-rc';
    fecha: Date;
    fileName: string;
    body: Buffer;
    contentType: string;
  }) {
    const config = this.getPrivateR2Config();
    const r2Key = buildPlatformSunatR2Key(params);
    await this.putObject(config.bucket, r2Key, params.body, params.contentType);
    return {
      r2Key,
      nombre: params.fileName,
      mimeType: params.contentType,
      sizeBytes: params.body.length,
    };
  }

  async deleteSunatCertificate(r2Key: string | null | undefined) {
    if (!r2Key) {
      return;
    }

    await this.deleteObject(this.getPrivateR2Config().bucket, r2Key);
  }

  downloadSunatCertificate(r2Key: string) {
    return this.getObjectBuffer(this.getPrivateR2Config().bucket, r2Key);
  }

  async uploadSunatDocument(params: {
    empresaId: bigint;
    ambiente: SunatAmbiente;
    tipo:
      | 'facturas'
      | 'boletas'
      | 'notas-credito'
      | 'guias-remision'
      | 'bajas-ra'
      | 'bajas-rc';
    fecha: Date;
    fileName: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredSunatDocument> {
    const config = this.getPrivateR2Config();
    const r2Key = buildCompanySunatR2Key(params);

    await this.putObject(config.bucket, r2Key, params.body, params.contentType);

    return {
      r2Key,
      nombre: params.fileName,
      mimeType: params.contentType,
      sizeBytes: params.body.length,
    };
  }

  getSignedSunatDocumentUrl(r2Key: string, fileName?: string) {
    const requestedTtl = Number(
      this.configService.get<string>('CLOUDFLARE_R2_SIGNED_URL_TTL_SECONDS') ??
        '300',
    );
    const expiresIn = Number.isFinite(requestedTtl)
      ? Math.min(900, Math.max(60, requestedTtl))
      : 300;
    return getSignedUrl(
      this.getClient(),
      new GetObjectCommand({
        Bucket: this.getPrivateR2Config().bucket,
        Key: r2Key,
        ResponseContentDisposition: fileName
          ? `attachment; filename="${this.sanitizeFileName(fileName)}"`
          : undefined,
      }),
      { expiresIn },
    );
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

    const config = this.getPublicR2Config();
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
      this.deleteObject(this.getPublicR2Config().bucket, params.r2KeyOriginal),
      this.deleteObject(this.getPublicR2Config().bucket, params.r2KeyWebp),
      this.deleteObject(this.getPublicR2Config().bucket, params.r2KeyThumbnail),
    ]);
  }

  private async deleteObject(bucket: string, key: string) {
    try {
      await this.getClient().send(
        new DeleteObjectCommand({
          Bucket: bucket,
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

  private async getObjectBuffer(bucket: string, key: string) {
    const response = await this.getClient().send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
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

  private getPublicR2Config() {
    const config = this.getR2BucketConfig('public');
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

  private getPrivateR2Config() {
    return this.getR2BucketConfig('private');
  }

  private getR2BucketConfig(visibility: 'public' | 'private') {
    const key =
      visibility === 'public'
        ? 'CLOUDFLARE_R2_PUBLIC_BUCKET'
        : 'CLOUDFLARE_R2_PRIVATE_BUCKET';
    const bucket =
      this.configService.get<string>(key) ??
      this.configService.get<string>('CLOUDFLARE_R2_BUCKET');

    if (!bucket) {
      throw new BadRequestException(`Configura ${key} de Cloudflare R2`);
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

  private sanitizeFileName(value: string) {
    return sanitizeR2FileName(value);
  }
}
