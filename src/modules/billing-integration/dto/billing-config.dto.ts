import { BillingEnvironment } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ProvisionBillingDto {
  @IsEnum(BillingEnvironment)
  environment!: BillingEnvironment;
}

export class UpdateBillingCredentialsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  solUsername?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  solPassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientSecret?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UploadBillingCertificateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class SetBillingEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}
