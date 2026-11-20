import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
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

  @IsOptional()
  @IsIn(['DNI', 'CE'])
  documentType?: 'DNI' | 'CE';

  /** Documento editado en el modal (si el cliente lo escribio mal en la venta). */
  @IsOptional()
  @Matches(/^\d{6,12}$/, { message: 'recipientDocument invalido' })
  recipientDocument?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientPaternalLastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  recipientMaternalLastName?: string;

  @IsOptional()
  @Matches(/^\d{6,12}$/, { message: 'recipientPhone invalido' })
  recipientPhone?: string;

  /** Agencia de origen elegida en el modal; se recuerda para la empresa. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  originAgency?: string;
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

/** Registro masivo: una clave global para todo el lote. */
export class BulkRegisterShalomDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  publicIds!: string[];

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
