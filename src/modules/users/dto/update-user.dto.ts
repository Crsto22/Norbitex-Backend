import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  IsEnum,
  Matches,
} from 'class-validator';
import { VisibilidadOperaciones } from '@prisma/client';

export class UpdateUserDto {
  @IsString()
  @MaxLength(100)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  apellido?: string;

  @IsEmail()
  @MaxLength(180)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  moduleKeys: string[];

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'sucursalId debe ser un identificador valido' })
  sucursalId?: string | null;

  @IsEnum(VisibilidadOperaciones)
  visibilidadOperaciones: VisibilidadOperaciones;
}
