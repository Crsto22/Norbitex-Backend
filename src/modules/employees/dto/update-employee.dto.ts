import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateEmployeeDto {
  @IsOptional()
  @IsIn(['dni', 'carnet_extranjeria', 'otro'])
  tipoDocumento?: 'dni' | 'carnet_extranjeria' | 'otro';

  @IsOptional()
  @IsString()
  @MaxLength(30)
  numeroDocumento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombres?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellidoPaterno?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellidoMaterno?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @IsOptional()
  @IsString()
  turnoId?: string | null;

  @IsOptional()
  @IsIn(['activo', 'inactivo'])
  estado?: 'activo' | 'inactivo';
}
