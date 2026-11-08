import { calcularFechasDespacho } from './shipping-dates.util';

describe('calcularFechasDespacho', () => {
  it('devuelve la cantidad solicitada de fechas', () => {
    const fechas = calcularFechasDespacho([0, 1, 2, 3, 4, 5, 6], '00:00', 0, 7);
    expect(fechas).toHaveLength(7);
    expect(fechas[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('devuelve un arreglo vacio si no hay dias habilitados', () => {
    expect(calcularFechasDespacho([], '18:00')).toEqual([]);
  });

  it('respeta los dias habilitados', () => {
    const fechas = calcularFechasDespacho([1], '00:00', 0, 14);
    for (const fecha of fechas) {
      const [year, month, day] = fecha.split('-').map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      expect(weekday).toBe(1);
    }
  });

  it('no repite fechas y las ordena de forma ascendente', () => {
    const fechas = calcularFechasDespacho(
      [0, 1, 2, 3, 4, 5, 6],
      '23:59',
      0,
      14,
    );
    for (let i = 1; i < fechas.length; i += 1) {
      expect(fechas[i] > fechas[i - 1]).toBe(true);
    }
  });

  it('aplica los dias de anticipacion', () => {
    const base = calcularFechasDespacho(
      [0, 1, 2, 3, 4, 5, 6],
      '23:59',
      0,
      1,
    )[0];
    const conAnticipacion = calcularFechasDespacho(
      [0, 1, 2, 3, 4, 5, 6],
      '23:59',
      3,
      1,
    )[0];
    const baseDate = new Date(`${base}T12:00:00Z`);
    const esperado = new Date(baseDate.getTime() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(conAnticipacion).toBe(esperado);
  });
});
