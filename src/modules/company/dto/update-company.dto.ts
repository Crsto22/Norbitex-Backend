import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CanalConocimiento, CategoriaProducto } from '@prisma/client';

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombreComercial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tipoNegocio?: string;

  @IsOptional()
  categoriasProducto?: CategoriaProducto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  razonSocial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
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
  comoConocio?: CanalConocimiento;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  comoConocioOtro?: string;
}
