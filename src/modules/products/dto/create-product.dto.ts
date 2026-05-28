import {
  IsBooleanString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateProductDto {
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

  @IsString()
  colores: string;

  @IsString()
  variantes: string;

  @IsOptional()
  @IsString()
  imagenes?: string;
}
