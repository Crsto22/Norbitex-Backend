const TIME_ZONE = 'America/Lima';

type HoraCorte = { hora: number; minuto: number };

function parseHoraCorte(horaCorte: string): HoraCorte {
  const [hora, minuto] = horaCorte.split(':').map(Number);
  return { hora, minuto };
}

function getLimaParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => {
    const part = parts.find((item) => item.type === type);
    return part ? Number(part.value) : 0;
  };

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
  };
}

function pad(value: number, length: number) {
  return String(value).padStart(length, '0');
}

function toYmd(year: number, month: number, day: number) {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function utcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Calcula las próximas fechas de despacho disponibles según los días de la
 * semana habilitados y la hora de corte (zona America/Lima).
 *
 * - Si hoy es día de despacho y aún no pasó la hora de corte, hoy está
 *   disponible.
 * - Si ya pasó la hora de corte (o hoy no es día de despacho), la primera
 *   fecha disponible es el siguiente día habilitado.
 */
export function calcularFechasDespacho(
  diasSemana: number[],
  horaCorte: string,
  cantidad = 14,
): string[] {
  const dias = new Set(diasSemana);
  if (dias.size === 0) return [];

  const { hora, minuto } = parseHoraCorte(horaCorte);
  const ahora = getLimaParts(new Date());
  const pasoCorte = hora * 60 + minuto <= ahora.hour * 60 + ahora.minute;

  let cursor = utcDate(ahora.year, ahora.month, ahora.day);
  if (pasoCorte) {
    cursor = new Date(cursor.getTime() + 86_400_000);
  }

  const fechas: string[] = [];
  while (fechas.length < cantidad) {
    if (dias.has(cursor.getUTCDay())) {
      fechas.push(
        toYmd(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth() + 1,
          cursor.getUTCDate(),
        ),
      );
    }
    cursor = new Date(cursor.getTime() + 86_400_000);
  }

  return fechas;
}
