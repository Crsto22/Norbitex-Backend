import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class PurchaseOrderItemDto {
  @IsNumberString()
  productoVarianteId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costoUnitario!: number;
}

export class CreatePurchaseOrderDto {
  @IsNumberString()
  proveedorId!: string;

  @IsNumberString()
  destinoSucursalId!: string;

  @IsOptional()
  @IsIn(['factura', 'boleta', 'otro'])
  tipoComprobante?: 'factura' | 'boleta' | 'otro';

  @IsOptional()
  @IsDateString()
  fechaEmision?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  serie?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  numero?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];
}
