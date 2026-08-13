import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VentaTipoComprobante } from '@prisma/client';
import { CreateSalePagoDto } from '../../sales/dto/create-sale.dto';

export class ConvertQuotationToSaleDto {
  @IsOptional()
  @IsUUID('4')
  requestId?: string;

  @IsEnum(VentaTipoComprobante)
  tipoComprobante: VentaTipoComprobante;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  clienteId?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalePagoDto)
  pagos: CreateSalePagoDto[];

  @IsOptional()
  @IsString()
  observaciones?: string;
}
