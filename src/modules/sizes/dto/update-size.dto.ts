import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSizeDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
