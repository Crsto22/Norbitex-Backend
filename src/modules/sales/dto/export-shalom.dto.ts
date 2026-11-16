import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { FindDeliveriesQueryDto } from './find-sales-query.dto';

/** Shalom acepta como maximo 50 envios por archivo. */
export const SHALOM_MAX_ROWS_PER_FILE = 50;
/** Shalom acepta hasta 10 encomiendas por destinatario en un mismo archivo. */
export const SHALOM_MAX_ROWS_PER_RECIPIENT = 10;
/** Tope defensivo para un solo lote de exportacion. */
export const SHALOM_MAX_EXPORT_SALES = 500;

export class ExportShalomMassiveDto extends FindDeliveriesQueryDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(SHALOM_MAX_EXPORT_SALES)
  @IsString({ each: true })
  @Type(() => String)
  publicIds?: string[];
}
