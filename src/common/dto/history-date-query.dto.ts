import { IsIn, IsOptional, Matches } from 'class-validator';

export const historyPeriods = [
  'today',
  'yesterday',
  'week',
  'month',
  'custom',
] as const;

export type HistoryPeriod = (typeof historyPeriods)[number];

export class HistoryDateQueryDto {
  @IsOptional()
  @IsIn(historyPeriods)
  period?: HistoryPeriod;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;
}
