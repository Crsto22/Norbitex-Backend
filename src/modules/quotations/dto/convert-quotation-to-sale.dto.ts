import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VentaTipoComprobante } from '@prisma/client';
import { CreateSalePagoDto } from '../../sales/dto/create-sale.dto';

export class ConvertQuotationToSaleDto {
  @IsEnum(VentaTipoComprobante)
  tipoComprobante: VentaTipoComprobante;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalePagoDto)
  pagos: CreateSalePagoDto[];

  @IsOptional()
  @IsString()
  observaciones?: string;
}
