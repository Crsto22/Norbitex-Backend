import { BadRequestException } from '@nestjs/common';
import type { HistoryPeriod } from './dto/history-date-query.dto';

type HistoryDateQuery = {
  period?: HistoryPeriod;
  dateFrom?: string;
  dateTo?: string;
  desde?: string;
  hasta?: string;
};

function limaDate(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function ensureDate(value: string, field: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${field} debe ser una fecha valida`);
  }
}

export function resolveHistoryDateRange(
  query: HistoryDateQuery,
  now = new Date(),
) {
  const period =
    query.period ??
    (query.dateFrom || query.dateTo || query.desde || query.hasta
      ? 'custom'
      : 'today');
  const today = limaDate(now);
  let from = today;
  let to = today;

  if (period === 'yesterday') {
    from = to = addDays(today, -1);
  } else if (period === 'week') {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    from = addDays(today, -((weekday + 6) % 7));
  } else if (period === 'month') {
    from = `${today.slice(0, 7)}-01`;
  } else if (period === 'custom') {
    from = query.dateFrom ?? query.desde ?? '';
    to = query.dateTo ?? query.hasta ?? from;
    if (!from || !to) {
      throw new BadRequestException(
        'El periodo personalizado requiere fecha inicial y final',
      );
    }
  }

  ensureDate(from, 'dateFrom');
  ensureDate(to, 'dateTo');
  if (from > to) {
    throw new BadRequestException('dateFrom no puede ser posterior a dateTo');
  }

  return {
    gte: new Date(`${from}T00:00:00-05:00`),
    lt: new Date(`${addDays(to, 1)}T00:00:00-05:00`),
  };
}
