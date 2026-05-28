import { IsIn, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class FindCurrentCashRegisterQueryDto {
  @IsString()
  sucursalId: string;
}

export class FindCashRegisterQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @IsString()
  usuarioId?: string;

  @IsOptional()
  @IsIn(['abierta', 'cerrada'])
  estado?: 'abierta' | 'cerrada';

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
