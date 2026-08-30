import 'reflect-metadata';
import { validate } from 'class-validator';
import {
  defaultApparelSizes,
  defaultCompanyColors,
  defaultFootwearSizes,
  getDefaultCompanyCatalogs,
} from './default-company-catalogs';
import { CreateCompanyDto } from './dto/create-company.dto';

describe('default company catalogs', () => {
  it('contains unique valid defaults', () => {
    expect(defaultCompanyColors).toHaveLength(20);
    expect(defaultApparelSizes).toHaveLength(6);
    expect(defaultFootwearSizes).toHaveLength(25);
    expect(
      new Set(defaultCompanyColors.map(({ nombreKey }) => nombreKey)).size,
    ).toBe(20);
    expect(
      new Set(defaultFootwearSizes.map(({ nombreKey }) => nombreKey)).size,
    ).toBe(25);
    expect(
      defaultCompanyColors.every(({ hex }) => /^#[0-9A-F]{6}$/.test(hex)),
    ).toBe(true);
  });

  it.each([
    ['ropa', 20, 6],
    ['calzado', 20, 25],
    ['ropa_calzado', 20, 31],
    ['otros', 0, 0],
  ] as const)('selects %s defaults', (profile, colors, sizes) => {
    const catalogs = getDefaultCompanyCatalogs(profile);

    expect(catalogs.colors).toHaveLength(colors);
    expect(catalogs.sizes).toHaveLength(sizes);
    expect(new Set(catalogs.sizes.map(({ nombreKey }) => nombreKey)).size).toBe(
      sizes,
    );
  });

  it.each([undefined, 'manipulado'])('rejects profile %s', async (profile) => {
    const dto = Object.assign(new CreateCompanyDto(), {
      productMode: 'pos',
      catalogProfile: profile,
    });
    const errors = await validate(dto);

    expect(errors.some(({ property }) => property === 'catalogProfile')).toBe(
      true,
    );
  });
});
