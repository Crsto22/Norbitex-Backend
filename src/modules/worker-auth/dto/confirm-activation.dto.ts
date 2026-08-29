import { IsString, Matches } from 'class-validator';

export class ConfirmActivationDto {
  @IsString()
  token!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  pin!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  confirmPin!: string;
}
