import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VentaEnvioAgencia } from '@prisma/client';

export class SubmitShippingDetailsDto {
  @IsString()
  @Length(3, 150)
  nombreCompleto: string;

  @IsString()
  @Matches(/^\d{8}$/, { message: 'El DNI debe tener 8 digitos' })
  dni: string;

  @IsString()
  @Matches(/^9\d{8}$/, {
    message: 'El celular debe tener 9 digitos y comenzar con 9',
  })
  celular: string;

  @IsString()
  @Length(1, 50)
  metodo: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de envio debe tener el formato YYYY-MM-DD',
  })
  fechaEnvio: string;

  @IsOptional()
  @IsEnum(VentaEnvioAgencia)
  agencia?: VentaEnvioAgencia;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  agenciaExternalId?: string;

  @IsOptional()
  @IsString()
  @Length(5, 500)
  direccionEntrega?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  referenciaEntrega?: string;
}

export class FindPublicShippingAgenciesDto {
  @IsEnum(VentaEnvioAgencia)
  agencia: VentaEnvioAgencia;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}
