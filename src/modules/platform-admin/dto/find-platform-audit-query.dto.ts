import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class FindPlatformAuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 15;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['company', 'plan', 'admin', 'subscription', 'billing', 'affiliate'])
  category?:
    | 'company'
    | 'plan'
    | 'admin'
    | 'subscription'
    | 'billing'
    | 'affiliate';

  @IsOptional()
  @IsIn([
    'company_created',
    'plan_changed',
    'plan_pricing_updated',
    'plan_limits_updated',
    'platform_admin_created',
    'platform_admin_status_changed',
    'subscription_sold',
    'subscription_sale_cancelled',
    'overage_pricing_updated',
    'company_limits_updated',
    'overage_closed',
    'overage_paid',
    'company_fiscal_data_updated',
    'sunat_config_updated',
    'sunat_certificate_uploaded',
    'sunat_certificate_deleted',
    'platform_billing_config_updated',
    'platform_receipt_issued',
    'platform_receipt_retried',
    'platform_credit_note_requested',
    'platform_extra_charge_created',
    'affiliate_created',
    'affiliate_updated',
    'company_affiliated',
    'affiliate_interrupted',
    'affiliate_settlement_closed',
    'affiliate_settlement_paid',
  ])
  action?:
    | 'company_created'
    | 'plan_changed'
    | 'plan_pricing_updated'
    | 'plan_limits_updated'
    | 'platform_admin_created'
    | 'platform_admin_status_changed'
    | 'subscription_sold'
    | 'subscription_sale_cancelled'
    | 'overage_pricing_updated'
    | 'company_limits_updated'
    | 'overage_closed'
    | 'overage_paid'
    | 'company_fiscal_data_updated'
    | 'sunat_config_updated'
    | 'sunat_certificate_uploaded'
    | 'sunat_certificate_deleted'
    | 'platform_billing_config_updated'
    | 'platform_receipt_issued'
    | 'platform_receipt_retried'
    | 'platform_credit_note_requested'
    | 'platform_extra_charge_created'
    | 'affiliate_created'
    | 'affiliate_updated'
    | 'company_affiliated'
    | 'affiliate_interrupted'
    | 'affiliate_settlement_closed'
    | 'affiliate_settlement_paid';

  @IsOptional()
  @IsIn(['registration', 'historical', 'cli', 'admin'])
  source?: 'registration' | 'historical' | 'cli' | 'admin';
}
