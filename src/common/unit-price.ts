import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function parseUnitPrice(value: string) {
  try {
    const price = new Prisma.Decimal(value);
    if (
      !price.isFinite() ||
      price.lte(0) ||
      price.gt(999999.99) ||
      price.decimalPlaces() > 2
    ) {
      throw new Error('Invalid price');
    }
    return price;
  } catch {
    throw new BadRequestException(
      'precioUnitario debe estar entre 0.01 y 999999.99',
    );
  }
}
