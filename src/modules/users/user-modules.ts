export const userModules = [
  { key: 'dashboard', label: 'Dashboard', route: '/dashboard' },
  { key: 'ventas-pos', label: 'Ventas POS', route: '/ventas' },
  { key: 'caja', label: 'Caja', route: '/caja' },
  { key: 'cotizaciones', label: 'Cotizaciones', route: '/cotizaciones' },
  {
    key: 'entregas-pendientes',
    label: 'Entregas pendientes',
    route: '/entregas-pendientes',
  },
  { key: 'clientes', label: 'Clientes', route: '/clientes' },
  {
    key: 'historial-ventas',
    label: 'Historial de ventas',
    route: '/historial/ventas',
  },
  {
    key: 'historial-cotizaciones',
    label: 'Historial cotizaciones',
    route: '/historial/cotizaciones',
  },
  {
    key: 'comprobantes',
    label: 'Comprobantes',
    route: '/facturacion/comprobantes',
  },
  {
    key: 'nota-credito',
    label: 'Nota de credito',
    route: '/facturacion/nota-credito',
  },
  { key: 'series', label: 'Series', route: '/facturacion/series' },
  { key: 'gre-remitente', label: 'GRE Remitente', route: '/gre/remitente' },
  { key: 'conductores', label: 'Conductores', route: '/gre/conductores' },
  { key: 'productos', label: 'Productos', route: '/catalogo/productos' },
  { key: 'categorias', label: 'Categorias', route: '/catalogo/categorias' },
  { key: 'marcas', label: 'Marcas', route: '/catalogo/marcas' },
  { key: 'tallas', label: 'Tallas', route: '/catalogo/tallas' },
  { key: 'colores', label: 'Colores', route: '/catalogo/colores' },
  {
    key: 'stock-movimientos',
    label: 'Movimientos de stock',
    route: '/stock/movimientos',
  },
  {
    key: 'stock-traspasos',
    label: 'Traspasos de stock',
    route: '/stock/traspasos',
  },
  {
    key: 'stock-kardex',
    label: 'Kardex de stock',
    route: '/stock/kardex',
  },
  {
    key: 'compras-ordenes',
    label: 'Ordenes de compra',
    route: '/compras/ordenes',
  },
  {
    key: 'compras-proveedores',
    label: 'Proveedores',
    route: '/compras/proveedores',
  },
  {
    key: 'sucursales',
    label: 'Sucursales',
    route: '/administracion/sucursales',
  },
  { key: 'usuarios', label: 'Usuarios', route: '/administracion/usuarios' },
  {
    key: 'reportes-ventas',
    label: 'Reporte de ventas',
    route: '/reportes/ventas',
  },
  {
    key: 'reportes-productos',
    label: 'Reporte de productos',
    route: '/reportes/productos',
  },
  {
    key: 'reportes-clientes',
    label: 'Reporte de clientes',
    route: '/reportes/clientes',
  },
  {
    key: 'reportes-usuarios',
    label: 'Reporte de usuarios',
    route: '/reportes/usuarios',
  },
  {
    key: 'asistencias-dashboard',
    label: 'Dashboard de asistencias',
    route: '/asistencias/dashboard',
  },
  {
    key: 'asistencias-personal',
    label: 'Personal',
    route: '/asistencias/personal',
  },
  {
    key: 'asistencias-marcajes',
    label: 'Marcaciones',
    route: '/asistencias/marcajes',
  },
  {
    key: 'asistencias-historial-marcaciones',
    label: 'Historial de marcaciones',
    route: '/asistencias/historial-marcaciones',
  },
  {
    key: 'asistencias-turnos',
    label: 'Turnos',
    route: '/asistencias/turnos',
  },
  {
    key: 'asistencias-puntos-qr',
    label: 'Puntos QR',
    route: '/asistencias/puntos-qr',
  },
  {
    key: 'asistencias-reportes',
    label: 'Reportes de asistencias',
    route: '/asistencias/reportes',
  },
  {
    key: 'asistencias-plan',
    label: 'Plan y facturacion de asistencias',
    route: '/asistencias/plan',
  },
  {
    key: 'asistencias-configuracion',
    label: 'Sucursales de asistencias',
    route: '/asistencias/configuracion',
  },
  {
    key: 'asistencias-empresa',
    label: 'Empresa de asistencias',
    route: '/asistencias/empresa',
  },
  {
    key: 'asistencias-mi-cuenta',
    label: 'Mi cuenta de asistencias',
    route: '/asistencias/mi-cuenta',
  },
  { key: 'empresa', label: 'Empresa', route: '/configuracion/empresa' },
  {
    key: 'metodos-pago',
    label: 'Metodos de pago',
    route: '/configuracion/metodos-pago',
  },
  { key: 'mi-cuenta', label: 'Mi cuenta', route: '/configuracion/mi-cuenta' },
] as const;

export type UserModuleKey = (typeof userModules)[number]['key'];

export const userModuleKeys = userModules.map((module) => module.key);
export const userModuleKeySet = new Set<string>(userModuleKeys);
export const warehouseUserModuleKeySet = new Set<string>([
  'productos',
  'categorias',
  'marcas',
  'tallas',
  'colores',
  'stock-movimientos',
  'stock-traspasos',
  'stock-kardex',
  'compras-ordenes',
  'compras-proveedores',
  'sucursales',
  'gre-remitente',
  'conductores',
  'mi-cuenta',
]);
export const userModuleMap: ReadonlyMap<string, (typeof userModules)[number]> =
  new Map(userModules.map((module) => [module.key, module]));
