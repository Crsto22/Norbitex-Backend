import { PlanCodigo } from '@prisma/client';
import type { UserModuleKey } from '../users/user-modules';

export type PlanLimits = {
  users: number;
  branches: number;
  warehouses: number | null;
  products: number;
  variants: number;
  documents: number;
  documentQueries: number;
  storageBytes: number;
};

export type PlanDefinition = {
  code: PlanCodigo;
  name: string;
  trialDays: number | null;
  moduleKeys: readonly UserModuleKey[];
  highlights: readonly string[];
};

const coreModuleKeys = [
  'dashboard',
  'ventas-pos',
  'caja',
  'cotizaciones',
  'entregas-pendientes',
  'clientes',
  'historial-ventas',
  'historial-cotizaciones',
  'comprobantes',
  'nota-credito',
  'series',
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
  'usuarios',
  'reportes-ventas',
  'reportes-productos',
  'empresa',
  'metodos-pago',
  'mi-cuenta',
] as const satisfies readonly UserModuleKey[];

const attendanceModuleKeys = [
  'asistencias-dashboard',
  'asistencias-personal',
  'asistencias-marcajes',
  'asistencias-turnos',
  'asistencias-puntos-qr',
  'asistencias-reportes',
  'asistencias-configuracion',
] as const satisfies readonly UserModuleKey[];

const allCoreModuleKeys = [
  ...coreModuleKeys,
  ...attendanceModuleKeys,
] as const satisfies readonly UserModuleKey[];

const basicModuleKeys = allCoreModuleKeys.filter(
  (key) => !['caja', 'usuarios'].includes(key),
) as Exclude<(typeof allCoreModuleKeys)[number], 'caja' | 'usuarios'>[];

const growthModuleKeys = [
  ...allCoreModuleKeys,
  'reportes-clientes',
  'reportes-usuarios',
] as const satisfies readonly UserModuleKey[];

const enterpriseModuleKeys = [
  ...growthModuleKeys,
  'gre-remitente',
  'conductores',
] as const satisfies readonly UserModuleKey[];

const ventureModuleKeys = enterpriseModuleKeys.filter(
  (key) => key !== 'reportes-usuarios',
);

export const planCatalog: Record<PlanCodigo, PlanDefinition> = {
  prueba: {
    code: PlanCodigo.prueba,
    name: 'Prueba',
    trialDays: 7,
    moduleKeys: enterpriseModuleKeys,
    highlights: [
      '7 dias de acceso',
      'Todos los modulos',
      '50 productos',
      '100 comprobantes',
    ],
  },
  basico: {
    code: PlanCodigo.basico,
    name: 'Básico',
    trialDays: null,
    moduleKeys: basicModuleKeys,
    highlights: [
      '1 usuario',
      '100 productos',
      '250 comprobantes al mes',
      'Reportes de ventas y productos',
    ],
  },
  emprendedor: {
    code: PlanCodigo.emprendedor,
    name: 'Emprende',
    trialDays: null,
    moduleKeys: ventureModuleKeys,
    highlights: [
      '2 tiendas',
      '3 usuarios',
      '450 productos',
      '1,000 comprobantes al mes',
      'GRE y conductores',
    ],
  },
  crecimiento: {
    code: PlanCodigo.crecimiento,
    name: 'Crece',
    trialDays: null,
    moduleKeys: enterpriseModuleKeys,
    highlights: [
      '3 tiendas',
      'Almacenes ilimitados',
      '10 usuarios',
      'Todos los modulos',
    ],
  },
  empresarial: {
    code: PlanCodigo.empresarial,
    name: 'Escala',
    trialDays: null,
    moduleKeys: enterpriseModuleKeys,
    highlights: [
      '20 tiendas',
      'Almacenes ilimitados',
      '30 usuarios',
      'Todos los modulos',
    ],
  },
};

export const planList = [
  planCatalog.prueba,
  planCatalog.basico,
  planCatalog.emprendedor,
  planCatalog.crecimiento,
  planCatalog.empresarial,
];
