import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const shippingLabelColumns = [1, 2] as const;
export type ShippingLabelColumns = (typeof shippingLabelColumns)[number];

export class PrintShippingLabelDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  packageCount: number;

  @Type(() => Number)
  @IsInt()
  @IsIn(shippingLabelColumns)
  columns: ShippingLabelColumns;
}

export class BatchShippingLabelItemDto {
  @IsString()
  publicId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  packageCount: number;
}

export class PrintShippingLabelBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BatchShippingLabelItemDto)
  sales: BatchShippingLabelItemDto[];

  @Type(() => Number)
  @IsInt()
  @IsIn(shippingLabelColumns)
  columns: ShippingLabelColumns;
}
