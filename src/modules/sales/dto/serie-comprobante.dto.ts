import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { VentaTipoComprobante } from '@prisma/client';

export class CreateSerieComprobanteDto {
  @IsEnum(VentaTipoComprobante)
  tipoComprobante: VentaTipoComprobante;

  @IsString()
  serie: string;

  @IsOptional()
  @IsBoolean()
  aplicaTodasSucursales?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sucursalIds?: string[];

  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;
}

export class UpdateSerieComprobanteDto {
  @IsOptional()
  @IsString()
  serie?: string;

  @IsOptional()
  @IsBoolean()
  esPrincipal?: boolean;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsBoolean()
  aplicaTodasSucursales?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sucursalIds?: string[];
}
