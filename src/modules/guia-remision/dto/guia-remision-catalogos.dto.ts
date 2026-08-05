import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { GuiaRemisionParticipanteTipo } from '@prisma/client';

export class FindCatalogosGuiaQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(GuiaRemisionParticipanteTipo)
  tipo?: GuiaRemisionParticipanteTipo;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  activo?: boolean;
}

export class CreateCatalogoParticipanteDto {
  @IsEnum(GuiaRemisionParticipanteTipo)
  tipo: GuiaRemisionParticipanteTipo;

  @IsString()
  tipoDocumento: string;

  @IsString()
  numeroDocumento: string;

  @IsOptional()
  @IsString()
  nombres?: string;

  @IsOptional()
  @IsString()
  apellidos?: string;

  @IsOptional()
  @IsString()
  razonSocial?: string;

  @IsOptional()
  @IsString()
  licencia?: string;

  @IsOptional()
  @IsString()
  registroMtc?: string;
}

export class UpdateCatalogoParticipanteDto extends CreateCatalogoParticipanteDto {
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class CreateCatalogoVehiculoDto {
  @IsString()
  placa: string;

  @IsOptional()
  @IsString()
  marca?: string;

  @IsOptional()
  @IsString()
  modelo?: string;
}

export class UpdateCatalogoVehiculoDto extends CreateCatalogoVehiculoDto {
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
