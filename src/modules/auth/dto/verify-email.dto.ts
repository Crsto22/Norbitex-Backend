import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyEmailDto {
  @IsEmail()
  @MaxLength(180)
  email: string;

  @IsString()
  @Matches(/^\d{6}$/)
  codigo: string;
}
