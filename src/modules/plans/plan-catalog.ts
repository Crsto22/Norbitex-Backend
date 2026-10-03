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
};

export const attendanceModuleKeys = [
  'asistencias-dashboard',
  'asistencias-personal',
  'asistencias-marcajes',
  'asistencias-historial-marcaciones',
  'asistencias-turnos',
  'asistencias-puntos-qr',
  'asistencias-reportes',
  'asistencias-plan',
  'asistencias-configuracion',
  'asistencias-empresa',
  'asistencias-mi-cuenta',
] as const satisfies readonly UserModuleKey[];

export const planCatalog: Record<PlanCodigo, PlanDefinition> = {
  prueba: {
    code: PlanCodigo.prueba,
    name: 'Prueba',
    trialDays: 7,
  },
  basico: {
    code: PlanCodigo.basico,
    name: 'Básico',
    trialDays: null,
  },
  emprendedor: {
    code: PlanCodigo.emprendedor,
    name: 'Emprende',
    trialDays: null,
  },
  crecimiento: {
    code: PlanCodigo.crecimiento,
    name: 'Crece',
    trialDays: null,
  },
  empresarial: {
    code: PlanCodigo.empresarial,
    name: 'Escala',
    trialDays: null,
  },
  pos_basico: {
    code: PlanCodigo.pos_basico,
    name: 'POS Básico',
    trialDays: null,
  },
  asistencias_basico: {
    code: PlanCodigo.asistencias_basico,
    name: 'Asistencias Básico',
    trialDays: null,
  },
  asistencias_pro: {
    code: PlanCodigo.asistencias_pro,
    name: 'Asistencias Pro',
    trialDays: null,
  },
  completo_emprende: {
    code: PlanCodigo.completo_emprende,
    name: 'Completo Emprende',
    trialDays: null,
  },
  completo_empresa: {
    code: PlanCodigo.completo_empresa,
    name: 'Completo Empresa',
    trialDays: null,
  },
};

export const planList = [
  planCatalog.prueba,
  planCatalog.basico,
  planCatalog.emprendedor,
  planCatalog.crecimiento,
  planCatalog.empresarial,
];
