import { BadRequestException } from '@nestjs/common';

export const SUNAT_UNIT_CODES = [
  { code: 'NIU', description: 'Unidad' },
  { code: 'ZZ', description: 'Servicio' },
  { code: 'KGM', description: 'Kilogramo' },
  { code: 'GRM', description: 'Gramo' },
  { code: 'LTR', description: 'Litro' },
  { code: 'MLT', description: 'Mililitro' },
  { code: 'MTR', description: 'Metro' },
  { code: 'CMT', description: 'Centimetro' },
  { code: 'MTK', description: 'Metro cuadrado' },
  { code: 'MTQ', description: 'Metro cubico' },
  { code: 'BX', description: 'Caja' },
  { code: 'BG', description: 'Bolsa' },
  { code: 'BO', description: 'Botella' },
  { code: 'BJ', description: 'Balde' },
  { code: 'BLL', description: 'Barril' },
  { code: 'CA', description: 'Lata' },
  { code: 'CY', description: 'Cilindro' },
  { code: 'DZN', description: 'Docena' },
  { code: 'PK', description: 'Paquete' },
  { code: 'PR', description: 'Par' },
  { code: 'SET', description: 'Juego' },
  { code: 'KT', description: 'Kit' },
  { code: 'TNE', description: 'Tonelada' },
  { code: 'GLL', description: 'Galon' },
  { code: 'FOT', description: 'Pie' },
  { code: 'INH', description: 'Pulgada' },
  { code: 'YRD', description: 'Yarda' },
  { code: 'C62', description: 'Pieza' },
] as const;

export function resolveSunatUnitCode(input?: string | null) {
  const code = input?.trim().toUpperCase() || 'NIU';
  const unit = SUNAT_UNIT_CODES.find((item) => item.code === code);

  if (!unit) {
    throw new BadRequestException(`Unidad SUNAT no permitida: ${code}`);
  }

  return unit;
}
