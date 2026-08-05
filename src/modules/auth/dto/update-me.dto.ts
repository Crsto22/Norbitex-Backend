import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMeDto {
  @IsString()
  @MaxLength(100)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellido?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;
}
