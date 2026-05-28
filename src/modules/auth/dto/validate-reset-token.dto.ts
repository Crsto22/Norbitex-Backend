import { IsString } from 'class-validator';

export class ValidateResetTokenDto {
  @IsString()
  token: string;
}
