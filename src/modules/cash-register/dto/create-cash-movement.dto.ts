import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCashMovementDto {
  @IsString()
  sucursalId: string;

  @IsIn(['ingreso', 'retiro'])
  tipo: 'ingreso' | 'retiro';

  @IsString()
  metodoPagoId: string;

  @IsString()
  monto: string;

  @IsString()
  @MaxLength(500)
  motivo: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  referencia?: string;
}
