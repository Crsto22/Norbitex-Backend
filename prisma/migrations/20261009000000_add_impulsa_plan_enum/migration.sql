-- Nuevo plan comercial "Impulsa".
-- El valor de enum debe agregarse en su propia migración: PostgreSQL no permite
-- usar un valor de enum nuevo dentro de la misma transacción en que se crea.
ALTER TYPE "PlanCodigo" ADD VALUE IF NOT EXISTS 'impulsa' BEFORE 'emprendedor';
