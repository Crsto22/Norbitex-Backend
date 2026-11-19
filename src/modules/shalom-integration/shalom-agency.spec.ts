import { resolveShalomAgencyName } from './shalom-agency';

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

  it('devuelve vacio cuando no hay datos', () => {
    expect(resolveShalomAgencyName(null, null)).toBe('');
    expect(resolveShalomAgencyName('', '   ')).toBe('');
  });
});
