import { CanalConocimiento } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombreComercial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  razonSocial?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{11}$/, { message: 'El RUC debe tener 11 digitos.' })
  ruc?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  direccion?: string;

  @IsOptional()
  @Type(() => String)
  @IsEnum(CanalConocimiento)
  comoConocio?: CanalConocimiento;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  comoConocioOtro?: string;
}
