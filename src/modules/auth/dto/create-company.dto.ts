import { CanalConocimiento } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  companyCatalogProfiles,
  type CompanyCatalogProfile,
} from '../default-company-catalogs';

export const companyProductModes = ['pos', 'attendance', 'both'] as const;
export type CompanyProductMode = (typeof companyProductModes)[number];

export class CreateCompanyDto {
  @IsIn(companyProductModes)
  productMode: CompanyProductMode;

  @IsIn(companyCatalogProfiles)
  catalogProfile: CompanyCatalogProfile;

  @IsString()
  @MaxLength(150)
  nombreComercial: string;

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
  @Matches(/^\d{8}$/, { message: 'El DNI debe tener 8 digitos.' })
  dni?: string;

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

  @Type(() => String)
  @IsEnum(CanalConocimiento)
  comoConocio: CanalConocimiento;

  @ValidateIf(
    (dto: CreateCompanyDto) => dto.comoConocio === CanalConocimiento.otro,
  )
  @IsString()
  @MaxLength(100)
  comoConocioOtro?: string;
}
