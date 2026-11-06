import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DeliverSaleDetalleDto } from './deliver-sale.dto';

export class DispatchToCourierDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliverSaleDetalleDto)
  detalles: DeliverSaleDetalleDto[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  numeroConstancia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string;
}

export class UpdateShippingStatusDto {
  @IsString()
  @IsIn(['EN_TRANSITO', 'ENTREGADO'])
  estado: 'EN_TRANSITO' | 'ENTREGADO';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notas?: string;
}

export class CreateShippingIncidentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  motivo: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  descripcion: string;
}

export class ResolveShippingIncidentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  solucion: string;
}
