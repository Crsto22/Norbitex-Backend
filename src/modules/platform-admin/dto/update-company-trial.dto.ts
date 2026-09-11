import { IsDateString } from 'class-validator';

export class UpdateCompanyTrialDto {
  @IsDateString()
  endsAt!: string;
}
