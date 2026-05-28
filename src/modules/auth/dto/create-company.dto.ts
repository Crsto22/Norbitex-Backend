import { CanalConocimiento, CategoriaProducto } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @MaxLength(150)
  nombreComercial: string;

  @IsString()
  @MaxLength(80)
  tipoNegocio: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(CategoriaProducto, { each: true })
  categoriasProducto: CategoriaProducto[];

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
  telefonoEmpresa?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  emailEmpresa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  direccion?: string;

  @IsEnum(CanalConocimiento)
  comoConocio: CanalConocimiento;

  @ValidateIf((dto: CreateCompanyDto) => dto.comoConocio === CanalConocimiento.otro)
  @IsString()
  @MaxLength(100)
  comoConocioOtro?: string;
}
