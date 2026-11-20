import {
  cleanAgencyName,
  isPlaceholderAgency,
  resolveShalomAgencyName,
} from './shalom-agency';

describe('resolveShalomAgencyName', () => {
  it('usa el nombre corto del catalogo cuando hay codigo', () => {
    expect(resolveShalomAgencyName('134', 'LIMA / LIMA / AGUAS VERDES')).toBe(
      'AGUAS VERDES',
    );
  });

  it('cae al ultimo segmento de la ruta cuando el codigo no esta en el catalogo', () => {
    expect(resolveShalomAgencyName('9999', 'LIMA / LIMA / LIMA CERCADO')).toBe(
      'LIMA CERCADO',
    );
  });

  it('quita el sufijo por definir del directorio', () => {
    expect(
      resolveShalomAgencyName(
        '747',
        'ANCASH / HUARAZ / INDEPENDENCIA / HUARAZ PALMIRA (POR DEFINIR)',
      ),
    ).toBe('HUARAZ PALMIRA');
  });

  it('devuelve vacio cuando no hay datos', () => {
    expect(resolveShalomAgencyName(null, null)).toBe('');
    expect(resolveShalomAgencyName('', '   ')).toBe('');
  });
});

describe('cleanAgencyName', () => {
  it('limpia espacios y el sufijo', () => {
    expect(cleanAgencyName('  PIMENTEL   ( por definir )  ')).toBe('PIMENTEL');
  });

  it('no toca los nombres normales', () => {
    expect(cleanAgencyName('BAGUA CAPITAL')).toBe('BAGUA CAPITAL');
  });
});

describe('isPlaceholderAgency', () => {
  it('detecta las agencias sin definir', () => {
    expect(isPlaceholderAgency('PIMENTEL (POR DEFINIR)')).toBe(true);
    expect(isPlaceholderAgency('PIMENTEL')).toBe(false);
    expect(isPlaceholderAgency(null)).toBe(false);
  });
});
