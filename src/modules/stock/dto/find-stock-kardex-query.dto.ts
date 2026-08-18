import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumberString,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class FindStockKardexQueryDto {
  @IsOptional()
  @IsNumberString()
  productoVarianteId?: string;

  @IsOptional()
  @IsNumberString()
  sucursalId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}
