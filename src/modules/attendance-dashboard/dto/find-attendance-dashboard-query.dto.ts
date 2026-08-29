import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const attendanceDashboardDateFilters = [
  'today',
  '7days',
  '14days',
  '30days',
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
}
