import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { VentaTipoComprobante } from '@prisma/client';

export class ConvertSaleDto {
  @IsIn([VentaTipoComprobante.boleta, VentaTipoComprobante.factura])
  tipoComprobante: VentaTipoComprobante;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  clienteId?: string | null;
}
