import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { VentaTipoComprobante } from '@prisma/client';

export class FindSeriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(VentaTipoComprobante)
  tipoComprobante?: VentaTipoComprobante;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sucursalId?: string;
}
