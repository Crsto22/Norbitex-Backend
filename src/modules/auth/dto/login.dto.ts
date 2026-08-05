import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  turnstileToken?: string;

  @IsEmail()
  @MaxLength(180)
  email: string;

  @IsString()
  password: string;
}
