import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MetodoPagoEstado } from '@prisma/client';

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descripcion?: string;

  @IsOptional()
  @IsEnum(MetodoPagoEstado)
  estado?: MetodoPagoEstado;
}
