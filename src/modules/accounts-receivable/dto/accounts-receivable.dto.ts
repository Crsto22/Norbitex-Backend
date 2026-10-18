import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CuentaPorCobrarEstado } from '@prisma/client';

export class FindAccountsReceivableQueryDto {
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
  clienteId?: string;

  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @IsEnum(CuentaPorCobrarEstado)
  estado?: CuentaPorCobrarEstado;

  @IsOptional()
  @IsIn(['vencida', 'vigente'])
  situacion?: 'vencida' | 'vigente';

  @IsOptional()
  @IsString()
  desde?: string;

  @IsOptional()
  @IsString()
  hasta?: string;
}

export class RegisterReceivablePaymentDto {
  @IsUUID('4')
  requestId: string;

  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsString()
  metodoPagoId: string;

  @IsString()
  monto: string;

  @IsOptional()
  @IsString()
  montoRecibido?: string;

  @IsOptional()
  @IsString()
  referencia?: string;
}

export class AnnulReceivablePaymentDto {
  @IsString()
  razon: string;
}
