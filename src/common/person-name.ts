/**
 * Utilidades para separar nombres y apellidos.
 *
 * Shalom pide el destinatario en tres campos (nombres, apellido paterno y
 * apellido materno). En Nuvex el enlace publico guarda el nombre completo en
 * un solo texto, por lo que aqui se reconstruyen las partes cuando el dato
 * separado no esta disponible.
 */

export type PersonNameParts = {
  nombres: string | null;
  apellidoPaterno: string | null;
  apellidoMaterno: string | null;
};

export type PersonNameSource = {
  nombres?: string | null;
  apellidoPaterno?: string | null;
  apellidoMaterno?: string | null;
  nombreCompleto?: string | null;
};

/** Conectores que forman parte de un apellido compuesto (DE LA CRUZ, DEL AGUILA...). */
const NAME_CONNECTORS = new Set([
  'DA',
  'DAS',
  'DE',
  'DEL',
  'DI',
  'DO',
  'DOS',
  'LA',
  'LAS',
  'LOS',
  'MAC',
  'MC',
  'SAN',
  'SANTA',
  'VAN',
  'VON',
]);

export function cleanPersonName(value?: string | null) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function joinTokens(tokens: string[], from: number, to: number) {
  if (from < 0 || to > tokens.length || from >= to) return null;
  return cleanPersonName(tokens.slice(from, to).join(' ')) || null;
}

/**
 * Divide un nombre completo en orden "nombres apellidos" (el orden que usa el
 * enlace publico de Nuvex).
 *
 * Ejemplos:
 *  - "CRISTHOFER QUISPE MAMANI"        -> nombres: CRISTHOFER, paterno: QUISPE, materno: MAMANI
 *  - "JOSE LUIS QUISPE MAMANI"         -> nombres: JOSE LUIS, paterno: QUISPE, materno: MAMANI
 *  - "CRISTHOFER QUISPE DE LA CRUZ"    -> nombres: CRISTHOFER, paterno: QUISPE, materno: DE LA CRUZ
 */
export function splitPersonFullName(
  fullName?: string | null,
): PersonNameParts {
  const value = cleanPersonName(fullName);
  if (!value) {
    return { nombres: null, apellidoPaterno: null, apellidoMaterno: null };
  }

  const tokens = value.split(' ');

  if (tokens.length === 1) {
    return {
      nombres: tokens[0],
      apellidoPaterno: null,
      apellidoMaterno: null,
    };
  }

  if (tokens.length === 2) {
    return {
      nombres: tokens[0],
      apellidoPaterno: tokens[1],
      apellidoMaterno: null,
    };
  }

  // El apellido materno arranca en la ultima palabra, arrastrando conectores.
  let maternalStart = tokens.length - 1;
  while (
    maternalStart > 2 &&
    NAME_CONNECTORS.has(tokens[maternalStart - 1].toUpperCase())
  ) {
    maternalStart -= 1;
  }

  // El apellido paterno es la palabra inmediatamente anterior (con conectores).
  let paternalStart = maternalStart - 1;
  while (
    paternalStart > 1 &&
    NAME_CONNECTORS.has(tokens[paternalStart - 1].toUpperCase())
  ) {
    paternalStart -= 1;
  }

  const nombres = joinTokens(tokens, 0, paternalStart);
  if (!nombres) {
    return {
      nombres: tokens[0],
      apellidoPaterno: joinTokens(tokens, 1, maternalStart),
      apellidoMaterno: joinTokens(tokens, maternalStart, tokens.length),
    };
  }

  return {
    nombres,
    apellidoPaterno: joinTokens(tokens, paternalStart, maternalStart),
    apellidoMaterno: joinTokens(tokens, maternalStart, tokens.length),
  };
}

/**
 * Resuelve las partes del destinatario priorizando los datos explicitos
 * (modal de Shalom) y luego las columnas del envio. Si faltan apellidos y
 * existe el nombre completo, se dividen automaticamente.
 */
export function resolvePersonNameParts(
  source?: PersonNameSource | null,
  override?: Omit<PersonNameSource, 'nombreCompleto'> | null,
): PersonNameParts {
  const split = splitPersonFullName(source?.nombreCompleto);

  return {
    nombres:
      cleanPersonName(override?.nombres) ||
      cleanPersonName(source?.nombres) ||
      split.nombres,
    apellidoPaterno:
      cleanPersonName(override?.apellidoPaterno) ||
      cleanPersonName(source?.apellidoPaterno) ||
      split.apellidoPaterno,
    apellidoMaterno:
      cleanPersonName(override?.apellidoMaterno) ||
      cleanPersonName(source?.apellidoMaterno) ||
      split.apellidoMaterno,
  };
}

/** Une las partes en el nombre completo que se muestra en el envio. */
export function composePersonFullName(parts: PersonNameParts) {
  const value = [parts.nombres, parts.apellidoPaterno, parts.apellidoMaterno]
    .map((part) => cleanPersonName(part))
    .filter(Boolean)
    .join(' ');

  return value || null;
}
