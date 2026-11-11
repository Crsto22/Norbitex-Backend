import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const envioPreviewColors = [
  '#101D69',
  '#111827',
  '#047857',
  '#EA580C',
  '#B91C1C',
  '#6D28D9',
  '#0F766E',
  '#7F1D1D',
] as const;

export class UpdateEnvioPreviewConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  titulo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  descripcion?: string | null;

  @IsIn(envioPreviewColors)
  colorPrimario: (typeof envioPreviewColors)[number];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  textoCentral?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(70)
  @Max(140)
  escalaContenido?: number;
}
