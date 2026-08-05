import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
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
  PlataformaComprobanteTipo,
} from '@prisma/client';

export class UpdateCompanyExtraLimitsDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) users!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) branches!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) warehouses!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_000) products!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_000) variants!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000_000) documents!: number;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  documentQueries!: number;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000_000)
  storageBytes!: number;
}

export class FindOveragesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 12;
  @IsOptional()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  search?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) period?: string;
  @IsOptional() @IsIn(['ready', 'open', 'pendiente', 'pagado']) status?:
    | 'ready'
    | 'open'
    | 'pendiente'
    | 'pagado';
}

export class CloseOverageDto {
  @IsUUID('4') requestId!: string;
  @Matches(/^[1-9]\d*$/) empresaId!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period!: string;
}

export class PayOverageDto {
  @IsUUID('4') requestId!: string;
  @IsEnum(PagoSuscripcionMetodo) paymentMethod!: PagoSuscripcionMetodo;
  @IsIn([
    PlataformaComprobanteTipo.nota_venta,
    PlataformaComprobanteTipo.boleta,
    PlataformaComprobanteTipo.factura,
  ])
  receiptType!: 'nota_venta' | 'boleta' | 'factura';

  @ValidateIf(
    (dto: PayOverageDto) => dto.paymentMethod === PagoSuscripcionMetodo.otro,
  )
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  paymentMethodOther?: string;
}
