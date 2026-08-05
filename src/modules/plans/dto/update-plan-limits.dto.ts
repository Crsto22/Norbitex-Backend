import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdatePlanLimitsDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) users!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) branches!: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  warehouses!: number | null;
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

  @IsDateString()
  expectedUpdatedAt!: string;
}
