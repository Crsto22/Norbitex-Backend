import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateAttendanceQrPointDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precisionMetros?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(10)
  @Max(1000)
  radioMetros?: number;

  @IsOptional()
  @IsIn(['activo', 'inactivo'])
  estado?: 'activo' | 'inactivo';

  @IsOptional()
  @IsIn(['normal', 'dinamico'])
  tipoQr?: 'normal' | 'dinamico';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(20)
  refreshSeconds?: number;
}
