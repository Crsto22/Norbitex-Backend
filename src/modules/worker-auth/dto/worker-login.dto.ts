import { IsString, Matches, MaxLength } from 'class-validator';

export class WorkerLoginDto {
  @IsString()
  @MaxLength(30)
  numeroDocumento!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  pin!: string;
}
