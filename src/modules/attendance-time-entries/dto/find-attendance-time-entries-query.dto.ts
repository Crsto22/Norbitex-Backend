import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString } from 'class-validator';

export const attendanceTimeEntryRanges = [
  '7days',
  '14days',
  '21days',
  'month',
] as const;

export const attendanceTimeEntryStatuses = [
  'todos',
  'asistencias',
  'faltas',
  'tardanzas',
  'incompletos',
] as const;

export type AttendanceTimeEntryRange =
  (typeof attendanceTimeEntryRanges)[number];

export type AttendanceTimeEntryStatus =
  (typeof attendanceTimeEntryStatuses)[number];

export class FindAttendanceTimeEntriesQueryDto {
  @IsOptional()
  @Type(() => String)
  @IsIn(attendanceTimeEntryRanges)
  range?: AttendanceTimeEntryRange = '7days';

  @IsOptional()
  @Type(() => String)
  @IsIn(attendanceTimeEntryStatuses)
  status?: AttendanceTimeEntryStatus = 'todos';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sucursalId?: string;

  @IsOptional()
  @IsString()
  turnoId?: string;
}
