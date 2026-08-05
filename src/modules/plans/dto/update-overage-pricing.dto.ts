import { IsDateString, Matches } from 'class-validator';

export class UpdateOveragePricingDto {
  @Matches(/^\d{1,6}(?:\.\d{1,2})?$/)
  unitPrice!: string;

  @IsDateString()
  expectedUpdatedAt!: string;
}
