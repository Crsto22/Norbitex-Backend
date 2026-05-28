import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VentaDescuentoTipo, VentaTipoComprobante } from '@prisma/client';

export class CreateSaleDetalleDto {
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

export class CreateSalePagoDto {
  @IsString()
  metodoPagoId: string;

  @IsString()
  monto: string;

  @IsOptional()
  @IsString()
  montoRecibido?: string;

  @IsOptional()
  @IsString()
  referencia?: string;
}

export class CreateSaleDto {
  @IsEnum(VentaTipoComprobante)
  tipoComprobante: VentaTipoComprobante;

  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  @IsEnum(VentaDescuentoTipo)
  descuentoTipo?: VentaDescuentoTipo;

  @IsOptional()
  @IsString()
  descuentoValor?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSaleDetalleDto)
  detalles: CreateSaleDetalleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalePagoDto)
  pagos: CreateSalePagoDto[];

  @IsOptional()
  @IsString()
  observaciones?: string;
}
