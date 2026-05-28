import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(180)
  email: string;

  @IsString()
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  ruc?: string;
}
