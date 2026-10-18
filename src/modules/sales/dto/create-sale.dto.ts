import {
  IsArray,
  ArrayMinSize,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsBoolean,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  VentaDescuentoTipo,
  VentaFormaPago,
  VentaTipoComprobante,
} from '@prisma/client';

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

export class CreateSaleCreditInstallmentDto {
  @IsInt()
  @Min(1)
  numero: number;

  @IsString()
  monto: string;

  @IsISO8601({ strict: true })
  fechaVencimiento: string;
}

export class CreateSaleCreditDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleCreditInstallmentDto)
  cuotas: CreateSaleCreditInstallmentDto[];
}

export class CreateSaleDto {
  @IsOptional()
  @IsUUID('4')
  requestId?: string;

  @IsEnum(VentaTipoComprobante)
  tipoComprobante: VentaTipoComprobante;

  @IsOptional()
  @IsEnum(VentaFormaPago)
  formaPago?: VentaFormaPago = VentaFormaPago.CONTADO;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSaleCreditDto)
  credito?: CreateSaleCreditDto;

  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  @IsBoolean()
  recogerDespues?: boolean;

  @IsOptional()
  @IsISO8601()
  recojoHasta?: string;

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
