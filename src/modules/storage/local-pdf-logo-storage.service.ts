import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import sharp from 'sharp';

type StoredPdfLogo = {
  url: string;
  path: string;
  contentType: 'image/webp';
};

@Injectable()
export class LocalPdfLogoStorageService {
  private readonly publicPrefix = '/storage';

  constructor(private readonly configService: ConfigService) {}

  async saveCompanyLogo(params: {
    empresaId: bigint;
    buffer: Buffer;
    previousUrl?: string | null;
  }): Promise<StoredPdfLogo> {
    await this.deleteCompanyLogo(params.previousUrl);

    const relativePath = join(
      'logos',
      `empresa-${params.empresaId.toString()}`,
      'logo-pdf.webp',
    );
    const absolutePath = this.resolveStoragePath(relativePath);
    const optimized = await sharp(params.buffer)
      .rotate()
      .resize({
        width: 320,
        height: 160,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, optimized);

    return {
      url: this.toPublicUrl(relativePath),
      path: absolutePath,
      contentType: 'image/webp',
    };
  }

  async saveCompanyLogoFromUrl(params: {
    empresaId: bigint;
    imageUrl: string;
    previousUrl?: string | null;
  }) {
    const response = await fetch(params.imageUrl);

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';

    if (contentType && !contentType.startsWith('image/')) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    return this.saveCompanyLogo({
      empresaId: params.empresaId,
      buffer,
      previousUrl: params.previousUrl,
    });
  }

  async resolveToDataUri(url: string | null | undefined) {
    if (!url) {
      return null;
    }

    const localPath = this.resolvePublicUrl(url);

    if (!localPath) {
      return null;
    }

    try {
      const buffer = await readFile(localPath);
      return `data:image/webp;base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  }

  async deleteCompanyLogo(url: string | null | undefined) {
    const localPath = this.resolvePublicUrl(url);

    if (!localPath) {
      return;
    }

    await rm(localPath, { force: true });
  }

  getStorageRoot() {
    const configured = this.configService.get<string>('LOCAL_STORAGE_DIR');
    return resolve(configured || resolve(process.cwd(), 'storage'));
  }

  private toPublicUrl(relativePath: string) {
    return `${this.publicPrefix}/${relativePath.replace(/\\/g, '/')}`;
  }

  private resolvePublicUrl(url: string | null | undefined) {
    if (!url?.startsWith(`${this.publicPrefix}/`)) {
      return null;
    }

    const relativePath = url.slice(this.publicPrefix.length + 1);
    return this.resolveStoragePath(relativePath);
  }

  private resolveStoragePath(relativePath: string) {
    const storageRoot = this.getStorageRoot();
    const absolutePath = resolve(storageRoot, relativePath);
    const normalizedRoot = storageRoot.endsWith(sep)
      ? storageRoot
      : `${storageRoot}${sep}`;

    if (!absolutePath.startsWith(normalizedRoot)) {
      throw new Error('Ruta de storage local invalida');
    }

    return absolutePath;
  }
}
