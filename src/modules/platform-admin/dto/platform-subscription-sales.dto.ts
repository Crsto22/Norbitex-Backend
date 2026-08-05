import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsDateString,
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
  PagoSuscripcionEstado,
  PagoSuscripcionMetodo,
  PlanCodigo,
  PlataformaComprobanteTipo,
} from '@prisma/client';

const trimString = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : (value as unknown);

export class FindSubscriptionSalesQueryDto {
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
  limit?: number = 12;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(PlanCodigo)
  plan?: PlanCodigo;

  @IsOptional()
  @IsEnum(PagoSuscripcionMetodo)
  method?: PagoSuscripcionMetodo;

  @IsOptional()
  @IsEnum(PagoSuscripcionEstado)
  status?: PagoSuscripcionEstado;

  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;
}

export class CreateSubscriptionSaleDto {
  @IsUUID('4')
  requestId!: string;

  @Matches(/^[1-9]\d*$/)
  empresaId!: string;

  @IsIn([
    PlanCodigo.basico,
    PlanCodigo.emprendedor,
    PlanCodigo.crecimiento,
    PlanCodigo.empresarial,
  ])
  planCode!: 'basico' | 'emprendedor' | 'crecimiento' | 'empresarial';

  @IsIn([1, 3, 6, 12])
  months!: 1 | 3 | 6 | 12;

  @IsDateString()
  pricingUpdatedAt!: string;

  @IsEnum(PagoSuscripcionMetodo)
  paymentMethod!: PagoSuscripcionMetodo;

  @IsIn([
    PlataformaComprobanteTipo.nota_venta,
    PlataformaComprobanteTipo.boleta,
    PlataformaComprobanteTipo.factura,
  ])
  receiptType!: 'nota_venta' | 'boleta' | 'factura';

  @IsOptional()
  @Transform(trimString)
  @Matches(/^[A-Za-z0-9-]{4,30}$/)
  affiliateCode?: string;

  @ValidateIf(
    (dto: CreateSubscriptionSaleDto) =>
      dto.paymentMethod === PagoSuscripcionMetodo.otro,
  )
  @Transform(trimString)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  paymentMethodOther?: string;
}

export class CancelSubscriptionSaleDto {
  @Transform(trimString)
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason!: string;
}
