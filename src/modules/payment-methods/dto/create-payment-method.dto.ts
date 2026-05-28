import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePaymentMethodDto {
  @IsString()
  @MaxLength(120)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descripcion?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
