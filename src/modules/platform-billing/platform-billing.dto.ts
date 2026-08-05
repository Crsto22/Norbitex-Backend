import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  PagoSuscripcionMetodo,
  PlataformaComprobanteEstado,
  PlataformaComprobanteTipo,
  SunatAmbiente,
} from '@prisma/client';

export const RECEIPT_TYPES = [
  PlataformaComprobanteTipo.nota_venta,
  PlataformaComprobanteTipo.boleta,
  PlataformaComprobanteTipo.factura,
] as const;

export class ReceiptTypeDto {
  @IsIn(RECEIPT_TYPES)
  receiptType!: (typeof RECEIPT_TYPES)[number];
}

export class UpdatePlatformIssuerDto {
  @IsOptional() @Matches(/^\d{11}$/) ruc?: string;
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MaxLength(200)
  businessName?: string;
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MaxLength(150)
  tradeName?: string;
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MaxLength(300)
  address?: string;
  @IsOptional() @Matches(/^\d{6}$/) ubigeo?: string;
  @IsOptional() @IsEnum(SunatAmbiente) environment?: SunatAmbiente;
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MaxLength(100)
  solUser?: string;
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MaxLength(150)
  solPassword?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  igvPercent?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UploadPlatformCertificateDto {
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  certificatePassword!: string;
}

export class UpsertPlatformSeriesDto {
  @IsEnum(PlataformaComprobanteTipo) type!: PlataformaComprobanteTipo;
  @Matches(/^[A-Z0-9]{4}$/) series!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class FindPlatformReceiptsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 15;
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  search?: string;
  @IsOptional()
  @IsEnum(PlataformaComprobanteTipo)
  type?: PlataformaComprobanteTipo;
  @IsOptional()
  @IsEnum(PlataformaComprobanteEstado)
  status?: PlataformaComprobanteEstado;
}

export class FindPlatformSeriesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 10;
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  search?: string;
  @IsOptional()
  @IsEnum(PlataformaComprobanteTipo)
  type?: PlataformaComprobanteTipo;
  @IsOptional() @IsIn(['activo', 'inactivo']) status?: 'activo' | 'inactivo';
}

export class IssueHistoricalReceiptDto extends ReceiptTypeDto {
  @IsUUID('4') requestId!: string;
  @IsIn(['subscription', 'overage']) sourceType!: 'subscription' | 'overage';
  @Matches(/^[1-9]\d*$/) sourceId!: string;
}

export class CreateExtraChargeDto extends ReceiptTypeDto {
  @IsUUID('4') requestId!: string;
  @Matches(/^[1-9]\d*$/) companyId!: string;
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  description!: string;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(1_000_000)
  quantity!: number;
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999_999.99)
  unitPrice!: number;
  @IsEnum(PagoSuscripcionMetodo) paymentMethod!: PagoSuscripcionMetodo;
  @ValidateIf(
    (dto: CreateExtraChargeDto) =>
      dto.paymentMethod === PagoSuscripcionMetodo.otro,
  )
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  paymentMethodOther?: string;
}

export class RequestPlatformCancellationDto {
  @IsUUID('4') requestId!: string;
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason!: string;
}
