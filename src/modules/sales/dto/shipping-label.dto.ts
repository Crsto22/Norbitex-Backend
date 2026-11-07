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

export const shippingLabelPaperFormats = ['THERMAL', 'A4'] as const;
export const shippingLabelOrientations = ['PORTRAIT', 'LANDSCAPE'] as const;

export type ShippingLabelPaperFormat =
  (typeof shippingLabelPaperFormats)[number];
export type ShippingLabelOrientation =
  (typeof shippingLabelOrientations)[number];

export class PrintShippingLabelDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  packageCount: number;

  @IsIn(shippingLabelPaperFormats)
  paperFormat: ShippingLabelPaperFormat;

  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2, 4])
  labelsPerPage: 1 | 2 | 4;

  @IsIn(shippingLabelOrientations)
  orientation: ShippingLabelOrientation;
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

  @IsIn(shippingLabelPaperFormats)
  paperFormat: ShippingLabelPaperFormat;

  @Type(() => Number)
  @IsInt()
  @IsIn([1, 2, 4])
  labelsPerPage: 1 | 2 | 4;

  @IsIn(shippingLabelOrientations)
  orientation: ShippingLabelOrientation;
}
