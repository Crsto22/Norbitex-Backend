import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterCompanyDto {
  @IsString()
  @MaxLength(150)
  nombreComercial: string;

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

  @IsString()
  @MaxLength(100)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellido?: string;

  @IsEmail()
  @MaxLength(180)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;
}
