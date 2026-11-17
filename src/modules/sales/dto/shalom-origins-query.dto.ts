import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const SHALOM_ORIGINS_PAGE_SIZE = 10;

export class ShalomOriginsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = SHALOM_ORIGINS_PAGE_SIZE;

  @IsOptional()
  @IsString()
  search?: string;
}
