import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateEmployeeDto {
  @IsIn(['dni', 'carnet_extranjeria', 'otro'])
  tipoDocumento!: 'dni' | 'carnet_extranjeria' | 'otro';

  @IsString()
  @MaxLength(30)
  numeroDocumento!: string;

  @IsString()
  @MaxLength(150)
  nombres!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellidoPaterno?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellidoMaterno?: string;

  @IsEmail()
  @MaxLength(180)
  email!: string;

  @IsString()
  @MaxLength(30)
  telefono!: string;

  @IsOptional()
  @IsString()
  turnoId?: string | null;
}
