import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class FindAttendanceTimeEntryHistoryQueryDto {
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
  limit?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  empleadoId?: string;

  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @IsIn(['entrada', 'salida'])
  tipo?: 'entrada' | 'salida';

  @IsOptional()
  @IsIn(['qr', 'manual'])
  metodo?: 'qr' | 'manual';

  @IsOptional()
  @IsIn(['valido', 'observado', 'anulado'])
  estado?: 'valido' | 'observado' | 'anulado';

  @IsOptional()
  @IsISO8601()
  desde?: string;

  @IsOptional()
  @IsISO8601()
  hasta?: string;
}
