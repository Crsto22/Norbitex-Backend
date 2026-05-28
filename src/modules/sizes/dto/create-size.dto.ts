import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSizeDto {
  @IsString()
  @MaxLength(80)
  nombre: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
