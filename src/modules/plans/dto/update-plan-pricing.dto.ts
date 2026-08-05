import { IsDateString, Matches } from 'class-validator';

export class UpdatePlanPricingDto {
  @Matches(/^[1-9]\d{0,5}(?:\.\d{1,2})?$/)
  priceMonthly!: string;

  @Matches(/^\d{1,2}(?:\.\d{1,2})?$/)
  monthlyDiscountPercent!: string;

  @Matches(/^\d{1,2}(?:\.\d{1,2})?$/)
  annualDiscountPercent!: string;

  @IsDateString()
  expectedUpdatedAt!: string;
}
