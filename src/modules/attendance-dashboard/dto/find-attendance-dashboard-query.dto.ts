import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export const attendanceDashboardDateFilters = [
  'today',
  'week',
  'fortnight',
  'month',
  '7days',
  '14days',
  '30days',
  'custom',
] as const;

export type AttendanceDashboardDateFilter =
  (typeof attendanceDashboardDateFilters)[number];

export class FindAttendanceDashboardQueryDto {
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @Type(() => String)
  @IsIn(attendanceDashboardDateFilters)
  dateFilter?: AttendanceDashboardDateFilter = 'today';

  @IsOptional()
  @IsISO8601()
  desde?: string;

  @IsOptional()
  @IsISO8601()
  hasta?: string;
}
