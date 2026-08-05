import {
  ArrayNotEmpty,
  IsEmail,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsEnum,
} from 'class-validator';
import { VisibilidadOperaciones } from '@prisma/client';

export class CreateUserDto {
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

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'La contrasena debe tener minimo 8 caracteres, mayuscula, minuscula y un numero.',
  })
  password: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  confirmarPassword: string;

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
