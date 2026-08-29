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
  attendanceEmployees: number;
  attendanceQrPoints: number;
};

export type PlanDefinition = {
  code: PlanCodigo;
  name: string;
  trialDays: number | null;
  moduleKeys: readonly UserModuleKey[];
  highlights: readonly string[];
};

export const coreModuleKeys = [
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

export const attendanceModuleKeys = [
  'asistencias-dashboard',
  'asistencias-personal',
  'asistencias-marcajes',
  'asistencias-historial-marcaciones',
  'asistencias-turnos',
  'asistencias-puntos-qr',
  'asistencias-reportes',
  'asistencias-configuracion',
] as const satisfies readonly UserModuleKey[];

const posBasicModuleKeys = coreModuleKeys.filter(
  (key) => !['caja', 'usuarios', 'gre-remitente', 'conductores'].includes(key),
) as UserModuleKey[];

const attendanceBasicModuleKeys = attendanceModuleKeys;

const attendanceProModuleKeys = attendanceModuleKeys;

const completeStarterModuleKeys = [
  ...posBasicModuleKeys,
  ...attendanceModuleKeys,
] as const satisfies readonly UserModuleKey[];

const basicModuleKeys = coreModuleKeys.filter(
  (key) => !['caja', 'usuarios'].includes(key),
) as Exclude<(typeof coreModuleKeys)[number], 'caja' | 'usuarios'>[];

const growthModuleKeys = [
  ...coreModuleKeys,
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
  pos_basico: {
    code: PlanCodigo.pos_basico,
    name: 'POS Básico',
    trialDays: null,
    moduleKeys: posBasicModuleKeys,
    highlights: [
      'POS e inventario',
      'Sin asistencias',
      '1 usuario',
      '250 comprobantes al mes',
    ],
  },
  asistencias_basico: {
    code: PlanCodigo.asistencias_basico,
    name: 'Asistencias Básico',
    trialDays: null,
    moduleKeys: attendanceBasicModuleKeys,
    highlights: ['10 trabajadores', '1 punto QR', 'Marcaciones e historial'],
  },
  asistencias_pro: {
    code: PlanCodigo.asistencias_pro,
    name: 'Asistencias Pro',
    trialDays: null,
    moduleKeys: attendanceProModuleKeys,
    highlights: ['30 trabajadores', '3 puntos QR', 'Reportes de asistencias'],
  },
  completo_emprende: {
    code: PlanCodigo.completo_emprende,
    name: 'Completo Emprende',
    trialDays: null,
    moduleKeys: completeStarterModuleKeys,
    highlights: ['POS + Asistencias', '15 trabajadores', '2 puntos QR'],
  },
  completo_empresa: {
    code: PlanCodigo.completo_empresa,
    name: 'Completo Empresa',
    trialDays: null,
    moduleKeys: enterpriseModuleKeys,
    highlights: [
      'POS + Asistencias completo',
      '100 trabajadores',
      '10 puntos QR',
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
