import { BadRequestException } from '@nestjs/common';

import { parseUnitPrice } from './unit-price';

describe('parseUnitPrice', () => {
  it.each(['0.01', '12', '999999.99'])('acepta %s', (value) => {
    expect(parseUnitPrice(value).toString()).toBe(value);
  });

  it.each(['0', '-1', '1.234', '1000000', 'texto'])('rechaza %s', (value) => {
    expect(() => parseUnitPrice(value)).toThrow(BadRequestException);
  });
});
