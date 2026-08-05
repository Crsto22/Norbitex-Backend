import {
  IsBooleanString,
  IsOptional,
  IsString,
  MaxLength,
  IsIn,
} from 'class-validator';

export class CreateProductDto {
  @IsOptional()
  @IsIn(['normal', 'variantes'])
  tipo?: 'normal' | 'variantes';

  @IsString()
  @MaxLength(180)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @IsOptional()
  @IsString()
  marcaId?: string;

  @IsOptional()
  @IsString()
  categoriaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  unidadMedidaCodigo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  tipoAfectacionIgvCodigo?: string;

  @IsOptional()
  @IsBooleanString()
  activo?: string;

  @IsOptional()
  @IsString()
  colores?: string;

  @IsOptional()
  @IsString()
  variantes?: string;

  @IsOptional()
  @IsString()
  simple?: string;

  @IsOptional()
  @IsString()
  imagenes?: string;
}
