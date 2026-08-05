import { resolveHistoryDateRange } from './history-date-range';

describe('resolveHistoryDateRange', () => {
  it('resolves default, preset and inclusive custom periods in Lima', () => {
    const now = new Date('2026-08-05T15:00:00Z');

    expect(resolveHistoryDateRange({}, now)).toEqual({
      gte: new Date('2026-08-05T05:00:00Z'),
      lt: new Date('2026-08-06T05:00:00Z'),
    });
    expect(resolveHistoryDateRange({ period: 'yesterday' }, now)).toEqual({
      gte: new Date('2026-08-04T05:00:00Z'),
      lt: new Date('2026-08-05T05:00:00Z'),
    });
    expect(
      resolveHistoryDateRange(
        { period: 'custom', dateFrom: '2026-08-01', dateTo: '2026-08-03' },
        now,
      ),
    ).toEqual({
      gte: new Date('2026-08-01T05:00:00Z'),
      lt: new Date('2026-08-04T05:00:00Z'),
    });
    expect(resolveHistoryDateRange({ desde: '2026-08-02' }, now)).toEqual({
      gte: new Date('2026-08-02T05:00:00Z'),
      lt: new Date('2026-08-03T05:00:00Z'),
    });
  });
});
