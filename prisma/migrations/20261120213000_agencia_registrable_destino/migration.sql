-- Marca si una agencia puede usarse como destino al registrar en Shalom.
-- Las agencias con nombre "(POR DEFINIR)" y los puntos internos (aeropuertos,
-- almacenes, pruebas) no son destinos validos del formulario de registro.
ALTER TABLE "agencia_courier"
  ADD COLUMN IF NOT EXISTS "registrable_destino" BOOLEAN NOT NULL DEFAULT true;
