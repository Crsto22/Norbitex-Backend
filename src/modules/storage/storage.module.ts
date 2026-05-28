import { Module } from '@nestjs/common';
import { LocalPdfLogoStorageService } from './local-pdf-logo-storage.service';
import { R2StorageService } from './r2-storage.service';

@Module({
  providers: [R2StorageService, LocalPdfLogoStorageService],
  exports: [R2StorageService, LocalPdfLogoStorageService],
})
export class StorageModule {}
