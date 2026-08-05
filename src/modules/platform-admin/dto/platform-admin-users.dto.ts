import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { UsuarioEstado } from '@prisma/client';

const trimString = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);

export class FindPlatformUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 12;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([UsuarioEstado.activo, UsuarioEstado.inactivo])
  status?: 'activo' | 'inactivo';
}

export class CreatePlatformUserDto {
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  nombre!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  apellido!: string;

  @Transform(trimString)
  @IsEmail()
  @MaxLength(180)
  email!: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(30)
  telefono?: string;
}

export class UpdatePlatformUserStatusDto {
  @IsIn([UsuarioEstado.activo, UsuarioEstado.inactivo])
  estado!: 'activo' | 'inactivo';
}
