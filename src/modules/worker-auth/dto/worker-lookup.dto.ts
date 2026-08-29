import { IsString, MaxLength } from 'class-validator';

export class WorkerLookupDto {
  @IsString()
  @MaxLength(30)
  numeroDocumento!: string;
}
