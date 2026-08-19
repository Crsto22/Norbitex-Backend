import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DeliverSaleDetalleDto {
  @IsString()
  ventaDetalleId: string;

  @IsInt()
  @Min(1)
  cantidad: number;
}

export class DeliverSaleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliverSaleDetalleDto)
  detalles: DeliverSaleDetalleDto[];

  @IsOptional()
  @IsString()
  retiranteDni?: string;

  @IsOptional()
  @IsString()
  retiranteNombre?: string;

  @IsOptional()
  @IsString()
  notas?: string;
}
