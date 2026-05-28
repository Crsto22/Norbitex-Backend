import {
  IsBoolean,
  IsDecimal,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { SunatAmbiente } from '@prisma/client';

export class UpdateSunatConfigDto {
  @IsOptional()
  @IsEnum(SunatAmbiente)
  ambiente?: SunatAmbiente;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  usuarioSol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  claveSol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientSecret?: string;

  @IsOptional()
  @Transform(({ value }) => String(value))
  @IsDecimal({ decimal_digits: '0,2' })
  igvPorcentaje?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
