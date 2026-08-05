import { IsIn, IsOptional } from 'class-validator';

export const platformDashboardDateFilters = [
  'today',
  '7days',
  '14days',
  '30days',
  'month',
  'year',
] as const;

export type PlatformDashboardDateFilter =
  (typeof platformDashboardDateFilters)[number];

export class PlatformDashboardQueryDto {
  @IsOptional()
  @IsIn(platformDashboardDateFilters)
  dateFilter: PlatformDashboardDateFilter = 'month';
}
