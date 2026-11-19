import { shalomAgencias } from '../sales/assets/shalom-masivo-catalogo';

/**
 * Catalogo oficial de agencias de Shalom compartido entre la exportacion
 * masiva y el registro individual por API.
 */
const AGENCIA_POR_CODIGO = new Map<string, string>(
  shalomAgencias.map(([codigo, nombre]) => [codigo, nombre]),
);

const AGENCIA_NOMBRES = new Set<string>(
  shalomAgencias.map(([, nombre]) => nombre),
);

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
    if (fromCatalog) return fromCatalog;
  }

  return (agenciaNombre ?? '').split(' / ').pop()?.trim() ?? '';
}

export function isKnownShalomAgency(nombre: string): boolean {
  return AGENCIA_NOMBRES.has(nombre.trim());
}
