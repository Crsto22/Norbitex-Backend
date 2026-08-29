import { IsString } from 'class-validator';

export class ValidateActivationDto {
  @IsString()
  token!: string;
}
