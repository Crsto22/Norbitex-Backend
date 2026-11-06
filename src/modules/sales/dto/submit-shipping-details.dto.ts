import {
  IsEnum,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
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

  @IsEnum(VentaEnvioAgencia)
  agencia: VentaEnvioAgencia;

  @IsString()
  @Length(1, 100)
  agenciaExternalId: string;
}

export class FindPublicShippingAgenciesDto {
  @IsEnum(VentaEnvioAgencia)
  agencia: VentaEnvioAgencia;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;
}
