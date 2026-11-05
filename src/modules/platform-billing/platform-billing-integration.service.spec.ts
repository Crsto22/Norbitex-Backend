import { BillingEnvironment } from '@prisma/client';
import { toBillingEnvironment } from './platform-billing-integration.service';

describe('toBillingEnvironment', () => {
  it('separa correctamente BETA y produccion', () => {
    expect(toBillingEnvironment('BETA')).toBe(BillingEnvironment.BETA);
    expect(toBillingEnvironment('PRODUCCION')).toBe(
      BillingEnvironment.PRODUCTION,
    );
  });
});
