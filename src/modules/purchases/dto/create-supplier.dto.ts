import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  @Matches(/^\d{11}$/)
  ruc!: string;

  @IsString()
  @MaxLength(200)
  razonSocial!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nombreComercial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  direccion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  personaContacto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefonoContacto?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
