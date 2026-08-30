import { Prisma } from '@prisma/client';
import {
  describeLimitIncreases,
  getIncludedAttendanceDocumentQueries,
} from './platform-overages.service';

describe('describeLimitIncreases', () => {
  it('returns only resources whose bonus increased', () => {
    expect(
      describeLimitIncreases(
        {
          users: 1,
          branches: 0,
          warehouses: 0,
          products: 100,
          variants: 0,
          documents: 20,
          documentQueries: 5,
          storageBytes: 0,
          attendanceEmployees: 0,
          attendanceQrPoints: 0,
        },
        {
          users: 3,
          branches: 0,
          warehouses: 0,
          products: 50,
          variants: 0,
          documents: 70,
          documentQueries: 15,
          storageBytes: 1024 * 1024 * 1024,
          attendanceEmployees: 0,
          attendanceQrPoints: 0,
        },
      ),
    ).toEqual([
      'usuarios +2',
      'comprobantes +50',
      'consultas DNI/RUC +10',
      'almacenamiento +1 GB',
    ]);
  });
});

describe('getIncludedAttendanceDocumentQueries', () => {
  it('assigns DNI/RUC queries by attendance monthly amount', () => {
    expect(getIncludedAttendanceDocumentQueries(new Prisma.Decimal(29.99))).toBe(
      20,
    );
    expect(getIncludedAttendanceDocumentQueries(new Prisma.Decimal(30))).toBe(
      100,
    );
    expect(getIncludedAttendanceDocumentQueries(new Prisma.Decimal(60))).toBe(
      300,
    );
    expect(getIncludedAttendanceDocumentQueries(new Prisma.Decimal(100))).toBe(
      800,
    );
  });
});
