import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export const SHALOM_PACKAGE_TYPES = [
  'SOBRE',
  'PAQUETE XXS',
  'PAQUETE XS',
  'PAQUETE S',
  'PAQUETE M',
  'PAQUETE L',
] as const;

export class UpdateShalomConfigDto {
  @IsUUID()
  tenantId!: string;

  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @IsString()
  @MinLength(20)
  apiKey!: string;

  @IsOptional()
  @IsString()
  @MinLength(16)
  webhookSecret?: string;

  @IsOptional()
  @IsIn(SHALOM_PACKAGE_TYPES)
  defaultPackageType?: (typeof SHALOM_PACKAGE_TYPES)[number];
}

export class RegisterShalomDto {
  /** Clave de 4 digitos que define el vendedor. */
  @Matches(/^\d{4}$/, { message: 'securityKey debe tener 4 digitos' })
  securityKey!: string;

  @IsOptional()
  @IsIn(SHALOM_PACKAGE_TYPES)
  packageType?: (typeof SHALOM_PACKAGE_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  extraSecurity?: boolean;

  @IsOptional()
  @IsBoolean()
  cashOnDelivery?: boolean;
}

/** Conecta la cuenta de Shalom PRO de la empresa. */
export class ProvisionShalomProDto {
  @IsEmail()
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsIn(SHALOM_PACKAGE_TYPES)
  packageType?: (typeof SHALOM_PACKAGE_TYPES)[number];
}
