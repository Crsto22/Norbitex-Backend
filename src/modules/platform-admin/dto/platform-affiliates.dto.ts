import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AfiliadoEstado, PagoSuscripcionMetodo } from '@prisma/client';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class FindAffiliatesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 12;
  @IsOptional() @Transform(trim) @IsString() search?: string;
  @IsOptional() @IsEnum(AfiliadoEstado) status?: AfiliadoEstado;
}

export class SaveAffiliateDto {
  @Transform(trim)
  @Matches(/^[A-Za-z0-9-]{4,30}$/)
  code!: string;

  @Transform(trim) @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(20) document?: string;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(180) email?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(30) phone?: string;
  @IsNumberString() discountPercent!: string;
  @IsNumberString() commissionPercent!: string;
  @IsOptional() @IsEnum(AfiliadoEstado) status?: AfiliadoEstado;
}

export class FindAffiliateCompaniesQueryDto extends FindAffiliatesQueryDto {
  @IsOptional() @Matches(/^[1-9]\d*$/) affiliateId?: string;
}

export class FindAffiliateCommissionsQueryDto extends FindAffiliateCompaniesQueryDto {
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period?: string;
}

export class ValidateAffiliateCodeQueryDto {
  @Matches(/^[1-9]\d*$/) companyId!: string;
  @Transform(trim) @Matches(/^[A-Za-z0-9-]{4,30}$/) code!: string;
}

export class CloseAffiliateSettlementDto {
  @IsUUID('4') requestId!: string;
  @Matches(/^[1-9]\d*$/) affiliateId!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period!: string;
}

export class PayAffiliateSettlementDto {
  @IsUUID('4') requestId!: string;
  @IsEnum(PagoSuscripcionMetodo) paymentMethod!: PagoSuscripcionMetodo;
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  reference!: string;
}
