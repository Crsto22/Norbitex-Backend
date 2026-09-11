import { Type } from 'class-transformer';
import { IsDateString, IsInt, Max, Min } from 'class-validator';

export class UpdatePlanTrialDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  trialDays!: number;

  @IsDateString()
  expectedUpdatedAt!: string;
}
