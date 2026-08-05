import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { SunatEstado, VentaEstado, VentaTipoComprobante } from '@prisma/client';
import { HistoryDateQueryDto } from '../../../common/dto/history-date-query.dto';

export class FindSalesQueryDto extends HistoryDateQueryDto {
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
  @Type(() => String)
  @IsEnum(VentaTipoComprobante)
  tipoComprobante?: VentaTipoComprobante;

  @IsOptional()
  @IsEnum(VentaEstado)
  estado?: VentaEstado;

  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @IsString()
  clienteId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class FindComprobantesQueryDto extends HistoryDateQueryDto {
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
  @Type(() => String)
  @IsIn([VentaTipoComprobante.factura, VentaTipoComprobante.boleta])
  tipoComprobante?: VentaTipoComprobante;

  @IsOptional()
  @Type(() => String)
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
  search?: string;
}
