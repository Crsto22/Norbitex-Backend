import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class FindStockKardexVariantsQueryDto {
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
  limit = 12;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsNumberString()
  categoriaId?: string;

  @IsOptional()
  @IsNumberString()
  colorId?: string;

  @IsOptional()
  @IsNumberString()
  tallaId?: string;

  @IsOptional()
  @IsNumberString()
  sucursalId?: string;
}
