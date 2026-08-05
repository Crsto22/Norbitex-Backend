import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const reportDateFilters = [
  'today',
  '7days',
  '14days',
  '30days',
] as const;

export type ReportDateFilter = (typeof reportDateFilters)[number];

export class FindReportQueryDto {
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @Type(() => String)
  @IsIn(reportDateFilters)
  dateFilter?: ReportDateFilter = 'today';
}
