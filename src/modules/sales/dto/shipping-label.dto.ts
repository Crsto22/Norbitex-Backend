import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class PrintShippingLabelDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  packageCount: number;
}

export class BatchShippingLabelItemDto extends PrintShippingLabelDto {
  @IsString()
  publicId: string;
}

export class PrintShippingLabelBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BatchShippingLabelItemDto)
  sales: BatchShippingLabelItemDto[];
}
