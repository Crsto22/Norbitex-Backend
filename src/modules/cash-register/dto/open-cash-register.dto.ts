import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CashRegisterAmountDto {
  @IsString()
  metodoPagoId: string;

  @IsString()
  monto: string;
}

export class OpenCashRegisterDto {
  @IsString()
  sucursalId: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CashRegisterAmountDto)
  saldosIniciales?: CashRegisterAmountDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observaciones?: string;
}
