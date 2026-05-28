import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CotizacionEstado, VentaDescuentoTipo } from '@prisma/client';
import { CreateQuotationDetalleDto } from './create-quotation.dto';

export class UpdateQuotationDto {
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateQuotationDetalleDto)
  detalles?: CreateQuotationDetalleDto[];

  @IsOptional()
  @IsString()
  observaciones?: string;

  @IsOptional()
  @IsDateString()
  validaHasta?: string;
}
