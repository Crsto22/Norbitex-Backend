import { IsIn, IsOptional } from 'class-validator';
import { FindProductsQueryDto } from './find-products-query.dto';

export const productExportFormats = ['xlsx', 'csv'] as const;

export type ProductExportFormat = (typeof productExportFormats)[number];

export class ExportProductsQueryDto extends FindProductsQueryDto {
  @IsOptional()
  @IsIn(productExportFormats)
  format?: ProductExportFormat = 'xlsx';
}
