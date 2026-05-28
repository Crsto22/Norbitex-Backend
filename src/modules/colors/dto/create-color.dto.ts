import { IsBoolean, IsHexColor, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateColorDto {
  @IsString()
  @MaxLength(80)
  nombre: string;

  @IsHexColor()
  hex: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
