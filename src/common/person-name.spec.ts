import {
  composePersonFullName,
  resolvePersonNameParts,
  splitPersonFullName,
} from './person-name';

describe('splitPersonFullName', () => {
  it('separa un nombre con un nombre y dos apellidos', () => {
    expect(splitPersonFullName('CRISTHOFER QUISPE MAMANI')).toEqual({
      nombres: 'CRISTHOFER',
      apellidoPaterno: 'QUISPE',
      apellidoMaterno: 'MAMANI',
    });
  });

  it('separa un nombre compuesto de dos nombres', () => {
    expect(splitPersonFullName('JOSE LUIS QUISPE MAMANI')).toEqual({
      nombres: 'JOSE LUIS',
      apellidoPaterno: 'QUISPE',
      apellidoMaterno: 'MAMANI',
    });
  });

  it('mantiene los apellidos compuestos con conectores', () => {
    expect(splitPersonFullName('CRISTHOFER QUISPE DE LA CRUZ')).toEqual({
      nombres: 'CRISTHOFER',
      apellidoPaterno: 'QUISPE',
      apellidoMaterno: 'DE LA CRUZ',
    });
  });

  it('normaliza espacios sobrantes', () => {
    expect(splitPersonFullName('  Maria   Lopez   Rojas ')).toEqual({
      nombres: 'Maria',
      apellidoPaterno: 'Lopez',
      apellidoMaterno: 'Rojas',
    });
  });

  it('no inventa apellidos cuando solo hay un nombre', () => {
    expect(splitPersonFullName('MARIA')).toEqual({
      nombres: 'MARIA',
      apellidoPaterno: null,
      apellidoMaterno: null,
    });
  });

  it('devuelve todo nulo cuando no hay nombre', () => {
    expect(splitPersonFullName('')).toEqual({
      nombres: null,
      apellidoPaterno: null,
      apellidoMaterno: null,
    });
  });
});

describe('resolvePersonNameParts', () => {
  it('prioriza los datos del modal sobre los del envio', () => {
    expect(
      resolvePersonNameParts(
        {
          nombreCompleto: 'JUAN PEREZ GOMEZ',
          nombres: 'JUAN',
          apellidoPaterno: 'PEREZ',
          apellidoMaterno: 'GOMEZ',
        },
        { apellidoPaterno: 'PEREZ CASTILLO' },
      ),
    ).toEqual({
      nombres: 'JUAN',
      apellidoPaterno: 'PEREZ CASTILLO',
      apellidoMaterno: 'GOMEZ',
    });
  });

  it('divide el nombre completo cuando el envio no tiene apellidos', () => {
    expect(
      resolvePersonNameParts({ nombreCompleto: 'JOSE LUIS QUISPE MAMANI' }),
    ).toEqual({
      nombres: 'JOSE LUIS',
      apellidoPaterno: 'QUISPE',
      apellidoMaterno: 'MAMANI',
    });
  });

  it('completa solo lo que falta', () => {
    expect(
      resolvePersonNameParts({
        nombreCompleto: 'CRISTHOFER QUISPE MAMANI',
        nombres: 'CRISTHOFER',
      }),
    ).toEqual({
      nombres: 'CRISTHOFER',
      apellidoPaterno: 'QUISPE',
      apellidoMaterno: 'MAMANI',
    });
  });
});

describe('composePersonFullName', () => {
  it('une las partes en el nombre completo', () => {
    expect(
      composePersonFullName({
        nombres: 'JUAN',
        apellidoPaterno: 'PEREZ',
        apellidoMaterno: 'GOMEZ',
      }),
    ).toBe('JUAN PEREZ GOMEZ');
  });

  it('ignora las partes vacias', () => {
    expect(
      composePersonFullName({
        nombres: 'JUAN',
        apellidoPaterno: null,
        apellidoMaterno: 'GOMEZ',
      }),
    ).toBe('JUAN GOMEZ');
  });
});
