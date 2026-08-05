import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SunatEstado, VentaTipoComprobante } from '@prisma/client';
import { HistoryDateQueryDto } from '../../../common/dto/history-date-query.dto';

export class CreditNoteItemDto {
  @IsString()
  ventaDetalleId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad: number;
}

export class CreateCreditNoteDto {
  @IsString()
  ventaPublicId: string;

  @IsOptional()
  @IsString()
  serieId?: string;

  @IsOptional()
  @IsString()
  serie?: string;

  @IsIn(['02', '03', '06', '07'])
  codigoMotivo: '02' | '03' | '06' | '07';

  @IsString()
  descripcionMotivo: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreditNoteItemDto)
  items?: CreditNoteItemDto[];
}

export class FindCreditNotesQueryDto extends HistoryDateQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([
    VentaTipoComprobante.nota_credito_factura,
    VentaTipoComprobante.nota_credito_boleta,
  ])
  tipoComprobante?: VentaTipoComprobante;

  @IsOptional()
  @IsIn([
    SunatEstado.pendiente_envio,
    SunatEstado.enviando,
    SunatEstado.aceptado,
    SunatEstado.observado,
    SunatEstado.rechazado,
    SunatEstado.error_transitorio,
    SunatEstado.error_definitivo,
  ])
  sunatEstado?: SunatEstado;

  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  @IsString()
  ventaPublicId?: string;

  @IsOptional()
  @IsString()
  desde?: string;

  @IsOptional()
  @IsString()
  hasta?: string;
}
