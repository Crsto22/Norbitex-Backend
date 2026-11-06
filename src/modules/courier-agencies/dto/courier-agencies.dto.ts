import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AgenciaCourierProveedor } from '@prisma/client';

export class SyncCourierAgenciesDto {
  @IsOptional()
  @IsEnum(AgenciaCourierProveedor)
  courier?: AgenciaCourierProveedor;
}

export class FindCourierAgenciesDto {
  @IsOptional()
  @IsEnum(AgenciaCourierProveedor)
  courier?: AgenciaCourierProveedor;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  ubigeo?: string;

  @IsOptional()
  @IsString()
  departamento?: string;

  @IsOptional()
  @IsString()
  provincia?: string;

  @IsOptional()
  @IsString()
  distrito?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  activo?: boolean;

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
  perPage = 30;
}
