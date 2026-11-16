import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const SHALOM_EXPORT_MODES = [
  'ninguno',
  'mercaderia',
  'medidas',
] as const;

export type ShalomExportMode = (typeof SHALOM_EXPORT_MODES)[number];

export const SHALOM_PACKAGE_TYPES = [
  'SOBRE',
  'PAQUETE XXS',
  'PAQUETE XS',
  'PAQUETE S',
  'PAQUETE M',
  'PAQUETE L',
] as const;

export type ShalomPackageType = (typeof SHALOM_PACKAGE_TYPES)[number];

export class UpdateShalomExportSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  origen?: string | null;

  @IsIn(SHALOM_EXPORT_MODES)
  modo!: ShalomExportMode;

  @IsOptional()
  @IsIn(SHALOM_PACKAGE_TYPES)
  mercaderia?: ShalomPackageType | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(9999.999)
  alto?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(9999.999)
  ancho?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(9999.999)
  largo?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9999.999)
  peso?: number | null;
}
