-- Marca cuando Shalom recepciona el paquete en la agencia de origen (EN_ORIGEN).
-- Permite distinguir una guia vencida antes de llevarla a la agencia (se revierte
-- el despacho automatico) de una anulada despues de recepcionada (incidencia).
ALTER TABLE "venta_envio"
  ADD COLUMN IF NOT EXISTS "shalom_recibido_en" TIMESTAMPTZ(6);
