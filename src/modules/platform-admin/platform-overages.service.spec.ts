import { describeLimitIncreases } from './platform-overages.service';

describe('describeLimitIncreases', () => {
  it('returns only resources whose bonus increased', () => {
    expect(
      describeLimitIncreases(
        {
          users: 1,
          branches: 0,
          products: 100,
          variants: 0,
          documents: 20,
          documentQueries: 5,
          storageBytes: 0,
        },
        {
          users: 3,
          branches: 0,
          products: 50,
          variants: 0,
          documents: 70,
          documentQueries: 15,
          storageBytes: 1024 * 1024 * 1024,
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
