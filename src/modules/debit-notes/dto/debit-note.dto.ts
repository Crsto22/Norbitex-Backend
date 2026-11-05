import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { SunatEstado, VentaTipoComprobante } from '@prisma/client';
import { HistoryDateQueryDto } from '../../../common/dto/history-date-query.dto';

export class DebitNoteAdjustmentDto {
  @IsString()
  ventaDetalleId!: string;

  @IsNumberString()
  importe!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  descripcion!: string;
}

export class CreateDebitNoteDto {
  @IsString()
  ventaPublicId!: string;

  @IsOptional()
  @IsString()
  serieId?: string;

  @IsOptional()
  @IsString()
  serie?: string;

  @IsIn(['01', '02', '03'])
  codigoMotivo!: '01' | '02' | '03';

  @IsString()
  @MinLength(3)
  @MaxLength(250)
  descripcionMotivo!: string;

  @IsDateString({ strict: true })
  fechaVencimiento!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DebitNoteAdjustmentDto)
  ajustes!: DebitNoteAdjustmentDto[];
}

export class FindDebitNotesQueryDto extends HistoryDateQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 12;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([
    VentaTipoComprobante.nota_debito_factura,
    VentaTipoComprobante.nota_debito_boleta,
  ])
  tipoComprobante?: VentaTipoComprobante;

  @IsOptional()
  @IsIn(Object.values(SunatEstado))
  sunatEstado?: SunatEstado;
}
