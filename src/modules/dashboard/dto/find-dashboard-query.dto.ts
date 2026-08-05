import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const dashboardDateFilters = [
  'today',
  '7days',
  '14days',
  '30days',
] as const;
export type DashboardDateFilter = (typeof dashboardDateFilters)[number];

export class FindDashboardQueryDto {
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @Type(() => String)
  @IsIn(dashboardDateFilters)
  dateFilter?: DashboardDateFilter = 'today';
}
