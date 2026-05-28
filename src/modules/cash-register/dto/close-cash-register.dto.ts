import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CashRegisterAmountDto } from './open-cash-register.dto';

export class CloseCashRegisterDto {
  @IsString()
  sucursalId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CashRegisterAmountDto)
  saldosDeclarados: CashRegisterAmountDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observaciones?: string;
}
