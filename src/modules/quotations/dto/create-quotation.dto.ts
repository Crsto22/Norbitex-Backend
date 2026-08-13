import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CotizacionEstado, VentaDescuentoTipo } from '@prisma/client';

export class CreateQuotationDetalleDto {
  @IsString()
  productoVarianteId: string;

  @IsInt()
  @Min(1)
  cantidad: number;

  @IsOptional()
  @IsString()
  precioUnitario?: string;

  @IsOptional()
  @IsEnum(VentaDescuentoTipo)
  descuentoTipo?: VentaDescuentoTipo;

  @IsOptional()
  @IsString()
  descuentoValor?: string;
}

export class CreateQuotationDto {
  @IsOptional()
  @IsUUID('4')
  requestId?: string;

  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  @IsEnum(CotizacionEstado)
  estado?: CotizacionEstado;

  @IsOptional()
  @IsEnum(VentaDescuentoTipo)
  descuentoTipo?: VentaDescuentoTipo;

  @IsOptional()
  @IsString()
  descuentoValor?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuotationDetalleDto)
  detalles: CreateQuotationDetalleDto[];

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsDateString()
  validaHasta?: string;
}
