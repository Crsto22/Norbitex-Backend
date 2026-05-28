import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @MaxLength(120)
  nombre: string;

  @IsIn(['tienda', 'almacen'])
  tipo: 'tienda' | 'almacen';

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  ubigeo: string;

  @IsString()
  @MaxLength(80)
  distrito: string;

  @IsString()
  @MaxLength(255)
  direccion: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  codigoEstablecimientoSunat?: string;

  @IsOptional()
  @IsIn(['activo', 'inactivo'])
  estado?: 'activo' | 'inactivo';

  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;

  @IsOptional()
  @IsBoolean()
  modoCajaHabilitado?: boolean;
}
