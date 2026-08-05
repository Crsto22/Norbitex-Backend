import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  turnstileToken: string;

  @IsEmail()
  @MaxLength(180)
  email: string;
}
