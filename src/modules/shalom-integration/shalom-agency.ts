import { shalomAgencias } from '../sales/assets/shalom-masivo-catalogo';

/**
 * Catalogo oficial de agencias de Shalom compartido entre la exportacion
 * masiva y el registro individual por API.
 */
const AGENCIA_POR_CODIGO = new Map<string, string>(
  shalomAgencias.map(([codigo, nombre]) => [codigo, nombre]),
);

const AGENCIA_NOMBRES = new Set<string>(
  shalomAgencias.map(([, nombre]) => cleanAgencyName(nombre)),
);

/**
 * El directorio publico de Shalom marca algunas agencias con el sufijo
 * "(POR DEFINIR)". El formulario de registro las muestra con el nombre limpio,
 * asi que se descarta el sufijo antes de buscar en el combo.
 */
export function cleanAgencyName(value?: string | null): string {
  return (value ?? '')
    .replace(/\s*\(\s*por definir\s*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nombre corto de la agencia tal como lo muestra el combo de Shalom.
 *
 * `venta_envio.agencia_nombre` guarda la ruta completa
 * ("LIMA / LIMA / LIMA CERCADO"), pero el asistente de Shalom busca por el
 * nombre corto del catalogo ("BAGUA CAPITAL").
 */
export function resolveShalomAgencyName(
  externalId?: string | null,
  agenciaNombre?: string | null,
): string {
  const code = externalId?.trim();
  if (code) {
    const fromCatalog = AGENCIA_POR_CODIGO.get(code);
    if (fromCatalog) return cleanAgencyName(fromCatalog);
  }

  const shortName = (agenciaNombre ?? '').split(' / ').pop()?.trim() ?? '';
  return cleanAgencyName(shortName);
}

export function isKnownShalomAgency(nombre: string): boolean {
  return AGENCIA_NOMBRES.has(cleanAgencyName(nombre));
}

/** El codigo de agencia existe en el catalogo oficial de registro. */
export function isCatalogShalomAgency(externalId?: string | null): boolean {
  const code = externalId?.trim();
  return Boolean(code && AGENCIA_POR_CODIGO.has(code));
}

/** La agencia viene del directorio con el nombre sin definir en Shalom. */
export function isPlaceholderAgency(nombre?: string | null): boolean {
  return /\(\s*por definir\s*\)/i.test(nombre ?? '');
}
