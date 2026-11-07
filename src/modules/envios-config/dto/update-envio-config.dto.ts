import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateEnvioConfigDto {
  @IsBoolean()
  activo!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  direccion?: string | null;
}
