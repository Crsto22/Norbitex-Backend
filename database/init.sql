-- Norbitex - Database Initialization
-- Generated from prisma/schema.prisma
-- PostgreSQL 16

-- Create schema if not exists
CREATE SCHEMA IF NOT EXISTS public;

SET search_path TO public;

-- ============================================================================
-- ENUM TYPES (48)
-- ============================================================================

CREATE TYPE "EmpresaEstado" AS ENUM ('activa', 'inactiva', 'suspendida');
CREATE TYPE "PlanCodigo" AS ENUM ('prueba', 'basico', 'emprendedor', 'crecimiento', 'empresarial');
CREATE TYPE "ConsultaDocumentoTipo" AS ENUM ('dni', 'ruc');
CREATE TYPE "ProductoTipo" AS ENUM ('normal', 'variantes');
CREATE TYPE "NotificacionCategoria" AS ENUM ('aviso', 'plan', 'facturacion', 'sunat', 'limite', 'stock', 'empresa');
CREATE TYPE "NotificacionNivel" AS ENUM ('informacion', 'exito', 'advertencia', 'error');
CREATE TYPE "NotificacionOrigen" AS ENUM ('manual', 'automatico');
CREATE TYPE "NotificacionAudiencia" AS ENUM ('todos', 'planes', 'empresa', 'usuario', 'superadmins', 'automatico');
CREATE TYPE "PagoSuscripcionMetodo" AS ENUM ('yape', 'plin', 'transferencia', 'deposito', 'efectivo', 'otro');
CREATE TYPE "PagoSuscripcionEstado" AS ENUM ('pagado', 'anulado');
CREATE TYPE "AfiliadoEstado" AS ENUM ('activo', 'inactivo');
CREATE TYPE "EmpresaAfiliacionEstado" AS ENUM ('activa', 'interrumpida', 'cancelada');
CREATE TYPE "ComisionAfiliadoTipo" AS ENUM ('venta', 'ajuste_anulacion');
CREATE TYPE "ComisionAfiliadoEstado" AS ENUM ('pendiente', 'liquidada', 'anulada');
CREATE TYPE "LiquidacionAfiliadoEstado" AS ENUM ('pendiente', 'pagada');
CREATE TYPE "LiquidacionExcedenteEstado" AS ENUM ('pendiente', 'pagado', 'anulado');
CREATE TYPE "PlataformaComprobanteTipo" AS ENUM ('nota_venta', 'boleta', 'factura', 'nota_credito');
CREATE TYPE "PlataformaComprobanteEstado" AS ENUM ('pendiente', 'aceptado', 'rechazado', 'error', 'anulacion_pendiente', 'anulado');
CREATE TYPE "CobroAdicionalEstado" AS ENUM ('pagado', 'anulado');
CREATE TYPE "PlataformaSunatJobEstado" AS ENUM ('pendiente', 'procesando', 'finalizado', 'error');
CREATE TYPE "PlataformaSunatJobOperacion" AS ENUM ('emision', 'baja');
CREATE TYPE "UsuarioEstado" AS ENUM ('activo', 'inactivo', 'bloqueado');
CREATE TYPE "EmpresaUsuarioEstado" AS ENUM ('activo', 'inactivo', 'invitado');
CREATE TYPE "VisibilidadOperaciones" AS ENUM ('propias', 'todas');
CREATE TYPE "CanalConocimiento" AS ENUM ('instagram', 'tiktok', 'facebook', 'youtube', 'google', 'whatsapp', 'recomendacion', 'otro');
CREATE TYPE "SucursalTipo" AS ENUM ('tienda', 'almacen');
CREATE TYPE "SucursalEstado" AS ENUM ('activo', 'inactivo');
CREATE TYPE "StockMovimientoDireccion" AS ENUM ('entrada', 'salida');
CREATE TYPE "StockMovimientoTipo" AS ENUM ('saldo_apertura', 'stock_inicial', 'entrada_manual', 'salida_manual', 'ajuste_producto', 'venta', 'anulacion_venta', 'nota_credito', 'traspaso_entrada', 'traspaso_salida');
CREATE TYPE "MetodoPagoEstado" AS ENUM ('activo', 'inactivo');
CREATE TYPE "ClienteTipoDocumento" AS ENUM ('dni', 'ruc', 'sin_documento');
CREATE TYPE "ClienteEstado" AS ENUM ('activo', 'inactivo');
CREATE TYPE "VentaTipoComprobante" AS ENUM ('nota_venta', 'factura', 'boleta', 'guia_remision', 'nota_credito_factura', 'nota_credito_boleta');
CREATE TYPE "GuiaRemisionEstado" AS ENUM ('borrador', 'emitida', 'aceptada', 'rechazada', 'anulada');
CREATE TYPE "GuiaRemisionParticipanteTipo" AS ENUM ('conductor', 'transportista');
CREATE TYPE "VentaEstado" AS ENUM ('pendiente', 'completada', 'anulada', 'nc_emitida');
CREATE TYPE "VentaDescuentoTipo" AS ENUM ('porcentaje', 'monto');
CREATE TYPE "VentaPagoEstado" AS ENUM ('activo', 'anulado');
CREATE TYPE "CajaSesionEstado" AS ENUM ('abierta', 'cerrada');
CREATE TYPE "CajaMovimientoTipo" AS ENUM ('apertura', 'venta', 'ingreso', 'retiro', 'anulacion_venta');
CREATE TYPE "CotizacionEstado" AS ENUM ('borrador', 'enviada', 'aceptada', 'rechazada', 'vencida', 'convertida', 'anulada');
CREATE TYPE "SunatAmbiente" AS ENUM ('BETA', 'PRODUCCION');
CREATE TYPE "SunatEndpointCodigo" AS ENUM ('BILL_SERVICE', 'CONSULTA_TICKET', 'API_TOKEN', 'API_CPE');
CREATE TYPE "SunatEstado" AS ENUM ('no_aplica', 'pendiente_envio', 'enviando', 'pendiente_cdr', 'aceptado', 'observado', 'rechazado', 'error_transitorio', 'error_definitivo');
CREATE TYPE "SunatBajaEstado" AS ENUM ('no_aplica', 'pendiente_envio', 'enviando', 'pendiente_cdr', 'aceptado', 'observado', 'rechazado', 'error_transitorio', 'error_definitivo');
CREATE TYPE "SunatBajaTipo" AS ENUM ('RA', 'RC');
CREATE TYPE "SunatJobTipoDocumento" AS ENUM ('venta', 'baja_lote', 'guia_remision', 'nota_credito');
CREATE TYPE "SunatJobEstado" AS ENUM ('pendiente_envio', 'procesando', 'finalizado', 'error_definitivo');

-- ============================================================================
-- TABLES (71) - Ordered by dependency: no FK tables first, then progressively
-- ============================================================================

-- Tier 0: No foreign keys to other tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "rol" (
  id              BIGSERIAL PRIMARY KEY,
  codigo          VARCHAR(50)  NOT NULL UNIQUE,
  nombre          VARCHAR(100) NOT NULL,
  descripcion     TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "unidad_medida" (
  id              BIGSERIAL PRIMARY KEY,
  codigo          VARCHAR(10)  NOT NULL UNIQUE,
  descripcion     VARCHAR(120) NOT NULL,
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "tipo_afectacion_igv" (
  id              BIGSERIAL PRIMARY KEY,
  codigo          VARCHAR(4)   NOT NULL UNIQUE,
  descripcion     VARCHAR(180) NOT NULL,
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "sunat_endpoint_config" (
  id              BIGSERIAL PRIMARY KEY,
  ambiente        "SunatAmbiente"       NOT NULL,
  codigo          "SunatEndpointCodigo" NOT NULL,
  url             VARCHAR(255)          NOT NULL,
  activo          BOOLEAN               NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  CONSTRAINT "sunat_endpoint_config_ambiente_codigo_key" UNIQUE (ambiente, codigo)
);
CREATE INDEX IF NOT EXISTS "sunat_endpoint_config_ambiente_idx" ON "sunat_endpoint_config" (ambiente);
CREATE INDEX IF NOT EXISTS "sunat_endpoint_config_activo_idx" ON "sunat_endpoint_config" (activo);

CREATE TABLE IF NOT EXISTS "secuencia_baja_plataforma" (
  id                BIGSERIAL PRIMARY KEY,
  tipo              "SunatBajaTipo" NOT NULL,
  fecha_generacion  DATE            NOT NULL,
  correlativo       INTEGER         NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  CONSTRAINT "secuencia_baja_plataforma_tipo_fecha_key" UNIQUE (tipo, fecha_generacion)
);

CREATE TABLE IF NOT EXISTS "registro_pendiente" (
  id              BIGSERIAL PRIMARY KEY,
  nombre          VARCHAR(100) NOT NULL,
  apellido        VARCHAR(100),
  email           VARCHAR(180) NOT NULL UNIQUE,
  password_hash   TEXT         NOT NULL,
  codigo_hash     TEXT         NOT NULL,
  expires_at      TIMESTAMPTZ  NOT NULL,
  intentos        INTEGER      NOT NULL DEFAULT 0,
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "registro_pendiente_expires_at_idx" ON "registro_pendiente" (expires_at);

CREATE TABLE IF NOT EXISTS "login_intento" (
  id                BIGSERIAL PRIMARY KEY,
  clave_hash        VARCHAR(64) NOT NULL UNIQUE,
  intentos          INTEGER     NOT NULL DEFAULT 0,
  ultimo_intento_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "serie_comprobante_plataforma" (
  id              BIGSERIAL PRIMARY KEY,
  tipo            "PlataformaComprobanteTipo" NOT NULL,
  serie           VARCHAR(4)                   NOT NULL UNIQUE,
  correlativo     INTEGER                      NOT NULL DEFAULT 0,
  activo          BOOLEAN                      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ                  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "serie_comprobante_plataforma_tipo_activo_idx" ON "serie_comprobante_plataforma" (tipo, activo);

-- Tier 1: Core entities (no FK columns, or only to other tier-1 tables)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "usuario" (
  id                      BIGSERIAL PRIMARY KEY,
  nombre                  VARCHAR(100) NOT NULL,
  apellido                VARCHAR(100),
  email                   VARCHAR(180) NOT NULL UNIQUE,
  password_hash           TEXT         NOT NULL,
  telefono                VARCHAR(30),
  estado                  "UsuarioEstado" NOT NULL DEFAULT 'activo',
  email_verificado        BOOLEAN      NOT NULL DEFAULT FALSE,
  es_super_admin          BOOLEAN      NOT NULL DEFAULT FALSE,
  refresh_token_version   INTEGER      NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "empresa" (
  id                    BIGSERIAL PRIMARY KEY,
  nombre_comercial      VARCHAR(150)          NOT NULL,
  razon_social          VARCHAR(200),
  ruc                   VARCHAR(20)           UNIQUE,
  dni                   VARCHAR(8)            UNIQUE,
  telefono              VARCHAR(30),
  email                 VARCHAR(150),
  direccion             TEXT,
  como_conocio          "CanalConocimiento",
  como_conocio_otro     VARCHAR(100),
  estado                "EmpresaEstado"       NOT NULL DEFAULT 'activa',
  plan_codigo           "PlanCodigo"          NOT NULL DEFAULT 'prueba',
  plan_inicio_at        TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  plan_fin_at           TIMESTAMPTZ,
  logo_url              VARCHAR(500),
  logo_pdf_url          VARCHAR(500),
  created_at            TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

-- Tier 2: Tables depending on Empresa and/or Usuario
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "sunat_config" (
  id                              BIGSERIAL PRIMARY KEY,
  empresa_id                     BIGINT          NOT NULL UNIQUE,
  ambiente                       "SunatAmbiente" NOT NULL DEFAULT 'BETA',
  usuario_sol_encrypted          TEXT,
  clave_sol_encrypted            TEXT,
  client_id_encrypted            TEXT,
  client_secret_encrypted        TEXT,
  certificado_password_encrypted TEXT,
  certificado_r2_key             VARCHAR(600),
  certificado_nombre             VARCHAR(180),
  certificado_mime_type          VARCHAR(80),
  certificado_size_bytes         INTEGER,
  certificado_uploaded_at        TIMESTAMPTZ,
  igv_porcentaje                 DECIMAL(5,2)    NOT NULL DEFAULT 18.00,
  activo                         BOOLEAN         NOT NULL DEFAULT FALSE,
  created_at                     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "sunat_config_empresa_id_idx" ON "sunat_config" (empresa_id);
CREATE INDEX IF NOT EXISTS "sunat_config_activo_idx" ON "sunat_config" (activo);

CREATE TABLE IF NOT EXISTS "color" (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      BIGINT       NOT NULL,
  nombre          VARCHAR(80)  NOT NULL,
  nombre_key      VARCHAR(100) NOT NULL,
  sistema_codigo  VARCHAR(40),
  hex             VARCHAR(7)   NOT NULL,
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  CONSTRAINT "color_empresa_nombre_key" UNIQUE (empresa_id, nombre_key),
  CONSTRAINT "color_empresa_sistema_codigo_key" UNIQUE (empresa_id, sistema_codigo)
);
CREATE INDEX IF NOT EXISTS "color_empresa_id_idx" ON "color" (empresa_id);
CREATE INDEX IF NOT EXISTS "color_deleted_at_idx" ON "color" (deleted_at);

CREATE TABLE IF NOT EXISTS "talla" (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      BIGINT       NOT NULL,
  nombre          VARCHAR(80)  NOT NULL,
  nombre_key      VARCHAR(100) NOT NULL,
  sistema_codigo  VARCHAR(40),
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  CONSTRAINT "talla_empresa_nombre_key" UNIQUE (empresa_id, nombre_key),
  CONSTRAINT "talla_empresa_sistema_codigo_key" UNIQUE (empresa_id, sistema_codigo)
);
CREATE INDEX IF NOT EXISTS "talla_empresa_id_idx" ON "talla" (empresa_id);
CREATE INDEX IF NOT EXISTS "talla_deleted_at_idx" ON "talla" (deleted_at);

CREATE TABLE IF NOT EXISTS "marca" (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      BIGINT       NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  nombre_key      VARCHAR(140) NOT NULL,
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  CONSTRAINT "marca_empresa_nombre_key" UNIQUE (empresa_id, nombre_key)
);
CREATE INDEX IF NOT EXISTS "marca_empresa_id_idx" ON "marca" (empresa_id);
CREATE INDEX IF NOT EXISTS "marca_deleted_at_idx" ON "marca" (deleted_at);

CREATE TABLE IF NOT EXISTS "categoria" (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      BIGINT       NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  nombre_key      VARCHAR(140) NOT NULL,
  descripcion     VARCHAR(500),
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  CONSTRAINT "categoria_empresa_nombre_key" UNIQUE (empresa_id, nombre_key)
);
CREATE INDEX IF NOT EXISTS "categoria_empresa_id_idx" ON "categoria" (empresa_id);
CREATE INDEX IF NOT EXISTS "categoria_deleted_at_idx" ON "categoria" (deleted_at);

CREATE TABLE IF NOT EXISTS "sucursal" (
  id                              BIGSERIAL PRIMARY KEY,
  empresa_id                     BIGINT        NOT NULL,
  nombre                         VARCHAR(120)  NOT NULL,
  nombre_key                     VARCHAR(140)  NOT NULL,
  tipo                           "SucursalTipo" NOT NULL,
  ubigeo                         VARCHAR(6)    NOT NULL,
  distrito                       VARCHAR(80)   NOT NULL,
  direccion                      VARCHAR(255)  NOT NULL,
  codigo_establecimiento_sunat   VARCHAR(10),
  estado                         "SucursalEstado" NOT NULL DEFAULT 'activo',
  es_principal                   BOOLEAN       NOT NULL DEFAULT FALSE,
  modo_caja_habilitado           BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at                     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  CONSTRAINT "sucursal_empresa_nombre_key" UNIQUE (empresa_id, nombre_key)
);
CREATE INDEX IF NOT EXISTS "sucursal_empresa_id_idx" ON "sucursal" (empresa_id);
CREATE INDEX IF NOT EXISTS "sucursal_tipo_idx" ON "sucursal" (tipo);
CREATE INDEX IF NOT EXISTS "sucursal_ubigeo_idx" ON "sucursal" (ubigeo);
CREATE INDEX IF NOT EXISTS "sucursal_estado_idx" ON "sucursal" (estado);

CREATE TABLE IF NOT EXISTS "cliente" (
  id                BIGSERIAL PRIMARY KEY,
  empresa_id        BIGINT                 NOT NULL,
  tipo_documento    "ClienteTipoDocumento"  NOT NULL,
  numero_documento  VARCHAR(20),
  nombre            VARCHAR(150),
  razon_social      VARCHAR(200),
  telefono          VARCHAR(30),
  email             VARCHAR(150),
  direccion         VARCHAR(255),
  ubigeo            VARCHAR(6),
  distrito          VARCHAR(80),
  estado            "ClienteEstado"         NOT NULL DEFAULT 'activo',
  created_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "cliente_empresa_id_idx" ON "cliente" (empresa_id);
CREATE INDEX IF NOT EXISTS "cliente_tipo_documento_idx" ON "cliente" (tipo_documento);
CREATE INDEX IF NOT EXISTS "cliente_numero_documento_idx" ON "cliente" (numero_documento);
CREATE INDEX IF NOT EXISTS "cliente_estado_idx" ON "cliente" (estado);
CREATE INDEX IF NOT EXISTS "cliente_empresa_estado_idx" ON "cliente" (empresa_id, estado);
CREATE INDEX IF NOT EXISTS "cliente_empresa_created_at_idx" ON "cliente" (empresa_id, created_at);

CREATE TABLE IF NOT EXISTS "metodo_pago" (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      BIGINT            NOT NULL,
  nombre          VARCHAR(120)      NOT NULL,
  nombre_key      VARCHAR(140)      NOT NULL,
  codigo          VARCHAR(40),
  descripcion     VARCHAR(500),
  es_sistema      BOOLEAN           NOT NULL DEFAULT FALSE,
  permite_vuelto  BOOLEAN           NOT NULL DEFAULT FALSE,
  orden           INTEGER           NOT NULL DEFAULT 100,
  estado          "MetodoPagoEstado" NOT NULL DEFAULT 'activo',
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  CONSTRAINT "metodo_pago_empresa_nombre_key" UNIQUE (empresa_id, nombre_key)
);
CREATE INDEX IF NOT EXISTS "metodo_pago_empresa_id_idx" ON "metodo_pago" (empresa_id);
CREATE INDEX IF NOT EXISTS "metodo_pago_codigo_idx" ON "metodo_pago" (codigo);
CREATE INDEX IF NOT EXISTS "metodo_pago_deleted_at_idx" ON "metodo_pago" (deleted_at);
CREATE INDEX IF NOT EXISTS "metodo_pago_estado_idx" ON "metodo_pago" (estado);

CREATE TABLE IF NOT EXISTS "catalogo_transporte_participante" (
  id                BIGSERIAL PRIMARY KEY,
  public_id         VARCHAR(30)                         NOT NULL UNIQUE,
  empresa_id        BIGINT                              NOT NULL,
  tipo              "GuiaRemisionParticipanteTipo"       NOT NULL,
  tipo_documento    VARCHAR(1)                           NOT NULL,
  numero_documento  VARCHAR(20)                          NOT NULL,
  nombres           VARCHAR(120),
  apellidos         VARCHAR(120),
  razon_social      VARCHAR(200),
  licencia          VARCHAR(20),
  registro_mtc      VARCHAR(20),
  activo            BOOLEAN                             NOT NULL DEFAULT TRUE,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ                         NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ                         NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  CONSTRAINT "catalogo_transporte_empresa_tipo_doc_key" UNIQUE (empresa_id, tipo, numero_documento)
);
CREATE INDEX IF NOT EXISTS "catalogo_transporte_participante_empresa_id_idx" ON "catalogo_transporte_participante" (empresa_id);
CREATE INDEX IF NOT EXISTS "catalogo_transporte_participante_tipo_idx" ON "catalogo_transporte_participante" (tipo);
CREATE INDEX IF NOT EXISTS "catalogo_transporte_participante_activo_idx" ON "catalogo_transporte_participante" (activo);
CREATE INDEX IF NOT EXISTS "catalogo_transporte_participante_deleted_at_idx" ON "catalogo_transporte_participante" (deleted_at);

CREATE TABLE IF NOT EXISTS "catalogo_vehiculo" (
  id              BIGSERIAL PRIMARY KEY,
  public_id       VARCHAR(30)  NOT NULL UNIQUE,
  empresa_id      BIGINT       NOT NULL,
  placa           VARCHAR(10)  NOT NULL,
  marca           VARCHAR(80),
  modelo          VARCHAR(80),
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  CONSTRAINT "catalogo_vehiculo_empresa_placa_key" UNIQUE (empresa_id, placa)
);
CREATE INDEX IF NOT EXISTS "catalogo_vehiculo_empresa_id_idx" ON "catalogo_vehiculo" (empresa_id);
CREATE INDEX IF NOT EXISTS "catalogo_vehiculo_activo_idx" ON "catalogo_vehiculo" (activo);
CREATE INDEX IF NOT EXISTS "catalogo_vehiculo_deleted_at_idx" ON "catalogo_vehiculo" (deleted_at);

CREATE TABLE IF NOT EXISTS "serie_comprobante" (
  id                      BIGSERIAL PRIMARY KEY,
  empresa_id              BIGINT                  NOT NULL,
  tipo_comprobante        "VentaTipoComprobante"  NOT NULL,
  serie                   VARCHAR(4)              NOT NULL,
  numero_actual           INTEGER                 NOT NULL DEFAULT 0,
  es_principal            BOOLEAN                 NOT NULL DEFAULT FALSE,
  aplica_todas_sucursales BOOLEAN                 NOT NULL DEFAULT TRUE,
  activo                  BOOLEAN                 NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  CONSTRAINT "serie_comprobante_empresa_tipo_serie_key" UNIQUE (empresa_id, tipo_comprobante, serie)
);
CREATE INDEX IF NOT EXISTS "serie_comprobante_empresa_id_idx" ON "serie_comprobante" (empresa_id);
CREATE INDEX IF NOT EXISTS "serie_comprobante_empresa_tipo_idx" ON "serie_comprobante" (empresa_id, tipo_comprobante);
CREATE INDEX IF NOT EXISTS "serie_comprobante_es_principal_idx" ON "serie_comprobante" (es_principal);

CREATE TABLE IF NOT EXISTS "sunat_job" (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      BIGINT                   NOT NULL,
  tipo_documento  "SunatJobTipoDocumento"  NOT NULL,
  documento_id    BIGINT                   NOT NULL,
  estado          "SunatJobEstado"         NOT NULL DEFAULT 'pendiente_envio',
  intentos        INTEGER                  NOT NULL DEFAULT 0,
  max_intentos    INTEGER                  NOT NULL DEFAULT 10,
  ultimo_error    VARCHAR(1000),
  ultimo_codigo   VARCHAR(40),
  next_retry_at   TIMESTAMPTZ,
  locked_at       TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  CONSTRAINT "sunat_job_tipo_documento_key" UNIQUE (tipo_documento, documento_id)
);
CREATE INDEX IF NOT EXISTS "sunat_job_empresa_id_idx" ON "sunat_job" (empresa_id);
CREATE INDEX IF NOT EXISTS "sunat_job_estado_next_retry_idx" ON "sunat_job" (estado, next_retry_at);
CREATE INDEX IF NOT EXISTS "sunat_job_locked_at_idx" ON "sunat_job" (locked_at);

CREATE TABLE IF NOT EXISTS "sunat_baja_lote" (
  id                  BIGSERIAL PRIMARY KEY,
  empresa_id          BIGINT           NOT NULL,
  tipo_envio          "SunatBajaTipo"  NOT NULL,
  fecha_documento     DATE             NOT NULL,
  fecha_generacion    DATE             NOT NULL,
  correlativo         INTEGER          NOT NULL,
  estado              "SunatBajaEstado" NOT NULL DEFAULT 'pendiente_envio',
  codigo              VARCHAR(20),
  mensaje             VARCHAR(500),
  ticket_sunat        VARCHAR(120),
  sunat_hash          VARCHAR(120),
  sunat_xml_nombre    VARCHAR(180),
  sunat_xml_key       VARCHAR(600),
  sunat_zip_nombre    VARCHAR(180),
  sunat_zip_key       VARCHAR(600),
  sunat_cdr_nombre    VARCHAR(180),
  sunat_cdr_key       VARCHAR(600),
  sunat_enviado_at    TIMESTAMPTZ,
  sunat_respondido_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  CONSTRAINT "sunat_baja_lote_unique_key" UNIQUE (empresa_id, tipo_envio, fecha_generacion, correlativo)
);
CREATE INDEX IF NOT EXISTS "sunat_baja_lote_empresa_id_idx" ON "sunat_baja_lote" (empresa_id);
CREATE INDEX IF NOT EXISTS "sunat_baja_lote_estado_idx" ON "sunat_baja_lote" (estado);
CREATE INDEX IF NOT EXISTS "sunat_baja_lote_tipo_fecha_idx" ON "sunat_baja_lote" (tipo_envio, fecha_documento, fecha_generacion);

CREATE TABLE IF NOT EXISTS "serie_comprobante_sucursal" (
  serie_comprobante_id  BIGINT      NOT NULL,
  sucursal_id           BIGINT      NOT NULL,
  empresa_id            BIGINT      NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (serie_comprobante_id, sucursal_id),
  FOREIGN KEY (serie_comprobante_id) REFERENCES "serie_comprobante" (id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES "sucursal" (id) ON DELETE CASCADE,
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "serie_comprobante_sucursal_empresa_id_idx" ON "serie_comprobante_sucursal" (empresa_id);
CREATE INDEX IF NOT EXISTS "serie_comprobante_sucursal_sucursal_id_idx" ON "serie_comprobante_sucursal" (sucursal_id);

-- Tier 3: Tables depending on Empresa + Usuario
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "afiliado" (
  id                    BIGSERIAL PRIMARY KEY,
  codigo                VARCHAR(30)  NOT NULL,
  codigo_key            VARCHAR(30)  NOT NULL UNIQUE,
  nombre                VARCHAR(160) NOT NULL,
  documento             VARCHAR(20),
  email                 VARCHAR(180),
  telefono              VARCHAR(30),
  descuento_porcentaje  DECIMAL(5,2) NOT NULL DEFAULT 0,
  comision_porcentaje   DECIMAL(5,2) NOT NULL DEFAULT 0,
  estado                "AfiliadoEstado" NOT NULL DEFAULT 'activo',
  creado_por_id         BIGINT       NOT NULL,
  actualizado_por_id    BIGINT       NOT NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (creado_por_id) REFERENCES "usuario" (id) ON DELETE RESTRICT,
  FOREIGN KEY (actualizado_por_id) REFERENCES "usuario" (id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "afiliado_estado_created_at_idx" ON "afiliado" (estado, created_at);

CREATE TABLE IF NOT EXISTS "tarifa_plan" (
  plan_codigo                   "PlanCodigo" NOT NULL PRIMARY KEY,
  precio_mensual                DECIMAL(12,2) NOT NULL,
  descuento_mensual_porcentaje  DECIMAL(5,2)  NOT NULL DEFAULT 0,
  descuento_anual_porcentaje    DECIMAL(5,2)  NOT NULL DEFAULT 0,
  actualizado_por_id            BIGINT,
  updated_at                    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  FOREIGN KEY (actualizado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "tarifa_plan_actualizado_por_id_idx" ON "tarifa_plan" (actualizado_por_id);

CREATE TABLE IF NOT EXISTS "limite_plan" (
  plan_codigo           "PlanCodigo" NOT NULL PRIMARY KEY,
  usuarios              BIGINT       NOT NULL,
  sucursales            BIGINT       NOT NULL,
  almacenes             BIGINT,
  productos             BIGINT       NOT NULL,
  variantes             BIGINT       NOT NULL,
  comprobantes          BIGINT       NOT NULL,
  consultas_documento   BIGINT       NOT NULL,
  almacenamiento_bytes  BIGINT       NOT NULL,
  actualizado_por_id    BIGINT,
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (actualizado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "limite_plan_actualizado_por_id_idx" ON "limite_plan" (actualizado_por_id);

CREATE TABLE IF NOT EXISTS "tarifa_comprobante_excedente" (
  id                INTEGER       NOT NULL PRIMARY KEY DEFAULT 1,
  precio_unitario   DECIMAL(12,2) NOT NULL,
  actualizado_por_id BIGINT,
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  FOREIGN KEY (actualizado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "configuracion_facturacion_plataforma" (
  id                              INTEGER          NOT NULL PRIMARY KEY DEFAULT 1,
  ruc                             VARCHAR(11),
  razon_social                    VARCHAR(200),
  nombre_comercial                VARCHAR(150),
  direccion                       TEXT,
  ubigeo                          VARCHAR(6),
  ambiente                        "SunatAmbiente"  NOT NULL DEFAULT 'BETA',
  usuario_sol_encrypted           TEXT,
  clave_sol_encrypted             TEXT,
  certificado_password_encrypted  TEXT,
  certificado_r2_key              VARCHAR(600),
  certificado_nombre              VARCHAR(180),
  certificado_mime_type           VARCHAR(80),
  certificado_size_bytes          INTEGER,
  certificado_uploaded_at         TIMESTAMPTZ,
  igv_porcentaje                  DECIMAL(5,2)     NOT NULL DEFAULT 18,
  activo                          BOOLEAN          NOT NULL DEFAULT FALSE,
  actualizado_por_id              BIGINT,
  created_at                      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  FOREIGN KEY (actualizado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "empresa_limite_adicional" (
  empresa_id            BIGINT       NOT NULL PRIMARY KEY,
  usuarios              BIGINT       NOT NULL DEFAULT 0,
  sucursales            BIGINT       NOT NULL DEFAULT 0,
  almacenes             BIGINT       NOT NULL DEFAULT 0,
  productos             BIGINT       NOT NULL DEFAULT 0,
  variantes             BIGINT       NOT NULL DEFAULT 0,
  comprobantes          BIGINT       NOT NULL DEFAULT 0,
  consultas_documento   BIGINT       NOT NULL DEFAULT 0,
  almacenamiento_bytes  BIGINT       NOT NULL DEFAULT 0,
  actualizado_por_id    BIGINT,
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (actualizado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "empresa_limite_adicional_actualizado_por_id_idx" ON "empresa_limite_adicional" (actualizado_por_id);

CREATE TABLE IF NOT EXISTS "empresa_usuario" (
  id                       BIGSERIAL PRIMARY KEY,
  empresa_id               BIGINT                       NOT NULL,
  usuario_id               BIGINT                       NOT NULL,
  sucursal_id              BIGINT,
  visibilidad_operaciones  "VisibilidadOperaciones"     NOT NULL DEFAULT 'todas',
  estado                   "EmpresaUsuarioEstado"       NOT NULL DEFAULT 'activo',
  created_at               TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES "usuario" (id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES "sucursal" (id) ON DELETE RESTRICT,
  CONSTRAINT "empresa_usuario_empresa_usuario_key" UNIQUE (empresa_id, usuario_id),
  CONSTRAINT "empresa_usuario_usuario_key" UNIQUE (usuario_id)
);
CREATE INDEX IF NOT EXISTS "empresa_usuario_empresa_id_idx" ON "empresa_usuario" (empresa_id);
CREATE INDEX IF NOT EXISTS "empresa_usuario_empresa_sucursal_idx" ON "empresa_usuario" (empresa_id, sucursal_id);

CREATE TABLE IF NOT EXISTS "empresa_usuario_modulo" (
  id                    BIGSERIAL PRIMARY KEY,
  empresa_usuario_id    BIGINT       NOT NULL,
  module_key            VARCHAR(80)  NOT NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_usuario_id) REFERENCES "empresa_usuario" (id) ON DELETE CASCADE,
  CONSTRAINT "empresa_usuario_modulo_unique_key" UNIQUE (empresa_usuario_id, module_key)
);
CREATE INDEX IF NOT EXISTS "empresa_usuario_modulo_empresa_usuario_id_idx" ON "empresa_usuario_modulo" (empresa_usuario_id);

CREATE TABLE IF NOT EXISTS "empresa_usuario_rol" (
  id                    BIGSERIAL PRIMARY KEY,
  empresa_usuario_id    BIGINT      NOT NULL,
  rol_id                BIGINT      NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_usuario_id) REFERENCES "empresa_usuario" (id) ON DELETE CASCADE,
  FOREIGN KEY (rol_id) REFERENCES "rol" (id) ON DELETE RESTRICT,
  CONSTRAINT "empresa_usuario_rol_unique_key" UNIQUE (empresa_usuario_id, rol_id)
);
CREATE INDEX IF NOT EXISTS "empresa_usuario_rol_empresa_usuario_id_idx" ON "empresa_usuario_rol" (empresa_usuario_id);

CREATE TABLE IF NOT EXISTS "refresh_token" (
  id                      BIGSERIAL PRIMARY KEY,
  usuario_id              BIGINT      NOT NULL,
  empresa_id              BIGINT,
  token_hash              TEXT        NOT NULL,
  refresh_token_version   INTEGER     NOT NULL DEFAULT 0,
  expires_at              TIMESTAMPTZ NOT NULL,
  revoked_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (usuario_id) REFERENCES "usuario" (id) ON DELETE CASCADE,
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "refresh_token_usuario_id_idx" ON "refresh_token" (usuario_id);
CREATE INDEX IF NOT EXISTS "refresh_token_empresa_id_idx" ON "refresh_token" (empresa_id);
CREATE INDEX IF NOT EXISTS "refresh_token_expires_at_idx" ON "refresh_token" (expires_at);

CREATE TABLE IF NOT EXISTS "password_reset_token" (
  id              BIGSERIAL PRIMARY KEY,
  usuario_id      BIGINT      NOT NULL,
  token_hash      TEXT        NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (usuario_id) REFERENCES "usuario" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "password_reset_token_usuario_id_idx" ON "password_reset_token" (usuario_id);
CREATE INDEX IF NOT EXISTS "password_reset_token_expires_at_idx" ON "password_reset_token" (expires_at);

CREATE TABLE IF NOT EXISTS "notificacion" (
  id                BIGSERIAL PRIMARY KEY,
  empresa_id        BIGINT,
  creado_por_id     BIGINT,
  categoria         "NotificacionCategoria"  NOT NULL,
  nivel             "NotificacionNivel"      NOT NULL,
  origen            "NotificacionOrigen"     NOT NULL,
  audiencia         "NotificacionAudiencia"  NOT NULL,
  audiencia_datos   JSONB,
  titulo            VARCHAR(120)             NOT NULL,
  mensaje           VARCHAR(700)             NOT NULL,
  enlace            VARCHAR(300),
  clave_evento      VARCHAR(300)             UNIQUE,
  expires_at        TIMESTAMPTZ,
  archived_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (creado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "notificacion_origen_created_at_idx" ON "notificacion" (origen, created_at);
CREATE INDEX IF NOT EXISTS "notificacion_empresa_created_at_idx" ON "notificacion" (empresa_id, created_at);
CREATE INDEX IF NOT EXISTS "notificacion_archived_expires_idx" ON "notificacion" (archived_at, expires_at);

CREATE TABLE IF NOT EXISTS "notificacion_destinatario" (
  id                BIGSERIAL PRIMARY KEY,
  notificacion_id   BIGINT      NOT NULL,
  usuario_id        BIGINT      NOT NULL,
  leido_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (notificacion_id) REFERENCES "notificacion" (id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES "usuario" (id) ON DELETE CASCADE,
  CONSTRAINT "notificacion_destinatario_unique_key" UNIQUE (notificacion_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS "notificacion_destinatario_usuario_leido_idx" ON "notificacion_destinatario" (usuario_id, leido_at, id);

CREATE TABLE IF NOT EXISTS "platform_audit_log" (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      BIGINT,
  usuario_id      BIGINT,
  category        VARCHAR(40)  NOT NULL,
  action          VARCHAR(80)  NOT NULL,
  source          VARCHAR(40)  NOT NULL,
  description     VARCHAR(300) NOT NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE SET NULL,
  FOREIGN KEY (usuario_id) REFERENCES "usuario" (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "platform_audit_log_category_created_at_idx" ON "platform_audit_log" (category, created_at);
CREATE INDEX IF NOT EXISTS "platform_audit_log_action_created_at_idx" ON "platform_audit_log" (action, created_at);
CREATE INDEX IF NOT EXISTS "platform_audit_log_empresa_created_at_idx" ON "platform_audit_log" (empresa_id, created_at);
CREATE INDEX IF NOT EXISTS "platform_audit_log_usuario_created_at_idx" ON "platform_audit_log" (usuario_id, created_at);
CREATE INDEX IF NOT EXISTS "platform_audit_log_created_at_idx" ON "platform_audit_log" (created_at);

CREATE TABLE IF NOT EXISTS "consulta_documento" (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      BIGINT                   NOT NULL,
  usuario_id      BIGINT                   NOT NULL,
  tipo            "ConsultaDocumentoTipo"  NOT NULL,
  created_at      TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES "usuario" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "consulta_documento_empresa_created_at_idx" ON "consulta_documento" (empresa_id, created_at);
CREATE INDEX IF NOT EXISTS "consulta_documento_usuario_created_at_idx" ON "consulta_documento" (usuario_id, created_at);

-- Tier 4: Product / Stock / Intermediate entities
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "producto" (
  id                      BIGSERIAL PRIMARY KEY,
  public_id               VARCHAR(30)              NOT NULL UNIQUE,
  empresa_id              BIGINT                   NOT NULL,
  marca_id                BIGINT,
  categoria_id            BIGINT,
  unidad_medida_id        BIGINT                   NOT NULL,
  tipo_afectacion_igv_id  BIGINT                   NOT NULL,
  nombre                  VARCHAR(180)             NOT NULL,
  tipo                    "ProductoTipo"           NOT NULL DEFAULT 'variantes',
  nombre_key              VARCHAR(220)             NOT NULL,
  descripcion             VARCHAR(1000),
  activo                  BOOLEAN                  NOT NULL DEFAULT TRUE,
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (marca_id) REFERENCES "marca" (id) ON DELETE SET NULL,
  FOREIGN KEY (categoria_id) REFERENCES "categoria" (id) ON DELETE SET NULL,
  FOREIGN KEY (unidad_medida_id) REFERENCES "unidad_medida" (id) ON DELETE RESTRICT,
  FOREIGN KEY (tipo_afectacion_igv_id) REFERENCES "tipo_afectacion_igv" (id) ON DELETE RESTRICT,
  CONSTRAINT "producto_empresa_nombre_key" UNIQUE (empresa_id, nombre_key)
);
CREATE INDEX IF NOT EXISTS "producto_empresa_id_idx" ON "producto" (empresa_id);
CREATE INDEX IF NOT EXISTS "producto_marca_id_idx" ON "producto" (marca_id);
CREATE INDEX IF NOT EXISTS "producto_categoria_id_idx" ON "producto" (categoria_id);
CREATE INDEX IF NOT EXISTS "producto_deleted_at_idx" ON "producto" (deleted_at);

CREATE TABLE IF NOT EXISTS "producto_color" (
  id              BIGSERIAL PRIMARY KEY,
  empresa_id      BIGINT      NOT NULL,
  producto_id     BIGINT      NOT NULL,
  color_id        BIGINT      NOT NULL,
  activo          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES "producto" (id) ON DELETE CASCADE,
  FOREIGN KEY (color_id) REFERENCES "color" (id) ON DELETE RESTRICT,
  CONSTRAINT "producto_color_producto_color_key" UNIQUE (producto_id, color_id)
);
CREATE INDEX IF NOT EXISTS "producto_color_empresa_id_idx" ON "producto_color" (empresa_id);
CREATE INDEX IF NOT EXISTS "producto_color_color_id_idx" ON "producto_color" (color_id);

CREATE TABLE IF NOT EXISTS "producto_color_imagen" (
  id                  BIGSERIAL PRIMARY KEY,
  empresa_id          BIGINT       NOT NULL,
  producto_color_id   BIGINT       NOT NULL,
  url_original        TEXT         NOT NULL,
  url_webp            TEXT         NOT NULL,
  url_thumbnail       TEXT         NOT NULL,
  r2_key_original     TEXT         NOT NULL,
  r2_key_webp         TEXT         NOT NULL,
  r2_key_thumbnail    TEXT         NOT NULL,
  mime_type           VARCHAR(80)  NOT NULL,
  size_bytes          INTEGER      NOT NULL,
  width               INTEGER,
  height              INTEGER,
  orden               INTEGER      NOT NULL DEFAULT 0,
  es_principal        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (producto_color_id) REFERENCES "producto_color" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "producto_color_imagen_empresa_id_idx" ON "producto_color_imagen" (empresa_id);
CREATE INDEX IF NOT EXISTS "producto_color_imagen_producto_color_id_idx" ON "producto_color_imagen" (producto_color_id);

CREATE TABLE IF NOT EXISTS "producto_variante" (
  id                  BIGSERIAL PRIMARY KEY,
  empresa_id          BIGINT          NOT NULL,
  producto_id         BIGINT          NOT NULL,
  producto_color_id   BIGINT          NOT NULL,
  talla_id            BIGINT          NOT NULL,
  sku                 VARCHAR(80),
  codigo_barras       VARCHAR(80),
  precio_compra       DECIMAL(12,2),
  precio_venta        DECIMAL(12,2)   NOT NULL,
  precio_mayorista    DECIMAL(12,2),
  activo              BOOLEAN         NOT NULL DEFAULT TRUE,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES "producto" (id) ON DELETE CASCADE,
  FOREIGN KEY (producto_color_id) REFERENCES "producto_color" (id) ON DELETE CASCADE,
  FOREIGN KEY (talla_id) REFERENCES "talla" (id) ON DELETE RESTRICT,
  CONSTRAINT "producto_variante_color_talla_key" UNIQUE (producto_color_id, talla_id),
  CONSTRAINT "producto_variante_empresa_sku_key" UNIQUE (empresa_id, sku),
  CONSTRAINT "producto_variante_empresa_codigo_barras_key" UNIQUE (empresa_id, codigo_barras)
);
CREATE INDEX IF NOT EXISTS "producto_variante_empresa_id_idx" ON "producto_variante" (empresa_id);
CREATE INDEX IF NOT EXISTS "producto_variante_producto_id_idx" ON "producto_variante" (producto_id);
CREATE INDEX IF NOT EXISTS "producto_variante_talla_id_idx" ON "producto_variante" (talla_id);
CREATE INDEX IF NOT EXISTS "producto_variante_deleted_at_idx" ON "producto_variante" (deleted_at);

CREATE TABLE IF NOT EXISTS "inventario_sucursal" (
  id                      BIGSERIAL PRIMARY KEY,
  empresa_id              BIGINT      NOT NULL,
  sucursal_id             BIGINT      NOT NULL,
  producto_variante_id    BIGINT      NOT NULL,
  stock_actual            INTEGER     NOT NULL DEFAULT 0,
  stock_minimo            INTEGER     NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES "sucursal" (id) ON DELETE CASCADE,
  FOREIGN KEY (producto_variante_id) REFERENCES "producto_variante" (id) ON DELETE CASCADE,
  CONSTRAINT "inventario_sucursal_sucursal_variante_key" UNIQUE (sucursal_id, producto_variante_id)
);
CREATE INDEX IF NOT EXISTS "inventario_sucursal_empresa_id_idx" ON "inventario_sucursal" (empresa_id);
CREATE INDEX IF NOT EXISTS "inventario_sucursal_producto_variante_id_idx" ON "inventario_sucursal" (producto_variante_id);

CREATE TABLE IF NOT EXISTS "stock_traspaso" (
  id                    BIGSERIAL PRIMARY KEY,
  public_id             VARCHAR(30)  NOT NULL UNIQUE,
  empresa_id            BIGINT       NOT NULL,
  origen_sucursal_id    BIGINT       NOT NULL,
  destino_sucursal_id   BIGINT       NOT NULL,
  motivo                VARCHAR(500) NOT NULL,
  creado_por_id         BIGINT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (origen_sucursal_id) REFERENCES "sucursal" (id) ON DELETE RESTRICT,
  FOREIGN KEY (destino_sucursal_id) REFERENCES "sucursal" (id) ON DELETE RESTRICT,
  FOREIGN KEY (creado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "stock_traspaso_empresa_created_at_idx" ON "stock_traspaso" (empresa_id, created_at);
CREATE INDEX IF NOT EXISTS "stock_traspaso_empresa_origen_created_at_idx" ON "stock_traspaso" (empresa_id, origen_sucursal_id, created_at);
CREATE INDEX IF NOT EXISTS "stock_traspaso_empresa_destino_created_at_idx" ON "stock_traspaso" (empresa_id, destino_sucursal_id, created_at);

CREATE TABLE IF NOT EXISTS "stock_traspaso_detalle" (
  id                      BIGSERIAL PRIMARY KEY,
  traspaso_id             BIGINT  NOT NULL,
  producto_variante_id    BIGINT  NOT NULL,
  cantidad                INTEGER NOT NULL,
  FOREIGN KEY (traspaso_id) REFERENCES "stock_traspaso" (id) ON DELETE CASCADE,
  FOREIGN KEY (producto_variante_id) REFERENCES "producto_variante" (id) ON DELETE RESTRICT,
  CONSTRAINT "stock_traspaso_detalle_unique_key" UNIQUE (traspaso_id, producto_variante_id)
);
CREATE INDEX IF NOT EXISTS "stock_traspaso_detalle_producto_variante_id_idx" ON "stock_traspaso_detalle" (producto_variante_id);

CREATE TABLE IF NOT EXISTS "stock_movimiento" (
  id                      BIGSERIAL PRIMARY KEY,
  empresa_id              BIGINT                        NOT NULL,
  sucursal_id             BIGINT                        NOT NULL,
  producto_variante_id    BIGINT                        NOT NULL,
  direccion               "StockMovimientoDireccion"    NOT NULL,
  tipo                    "StockMovimientoTipo"         NOT NULL,
  cantidad                INTEGER                       NOT NULL,
  stock_anterior          INTEGER                       NOT NULL,
  stock_posterior         INTEGER                       NOT NULL,
  motivo                  VARCHAR(500),
  referencia_tipo         VARCHAR(40),
  referencia_id           BIGINT,
  traspaso_id             BIGINT,
  creado_por_id           BIGINT,
  created_at              TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES "sucursal" (id) ON DELETE RESTRICT,
  FOREIGN KEY (producto_variante_id) REFERENCES "producto_variante" (id) ON DELETE RESTRICT,
  FOREIGN KEY (traspaso_id) REFERENCES "stock_traspaso" (id) ON DELETE RESTRICT,
  FOREIGN KEY (creado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "stock_movimiento_empresa_created_at_idx" ON "stock_movimiento" (empresa_id, created_at);
CREATE INDEX IF NOT EXISTS "stock_movimiento_empresa_sucursal_created_at_idx" ON "stock_movimiento" (empresa_id, sucursal_id, created_at);
CREATE INDEX IF NOT EXISTS "stock_movimiento_empresa_variante_created_at_idx" ON "stock_movimiento" (empresa_id, producto_variante_id, created_at);
CREATE INDEX IF NOT EXISTS "stock_movimiento_traspaso_id_idx" ON "stock_movimiento" (traspaso_id);

-- Tier 5: Sales / Cash / Complex documents
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "caja_sesion" (
  id                        BIGSERIAL PRIMARY KEY,
  public_id                 VARCHAR(30)          NOT NULL UNIQUE,
  empresa_id                BIGINT               NOT NULL,
  sucursal_id               BIGINT               NOT NULL,
  usuario_id                BIGINT               NOT NULL,
  estado                    "CajaSesionEstado"   NOT NULL DEFAULT 'abierta',
  opened_at                 TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  closed_at                 TIMESTAMPTZ,
  monto_inicial             DECIMAL(12,2)        NOT NULL DEFAULT 0,
  monto_esperado            DECIMAL(12,2),
  monto_declarado           DECIMAL(12,2),
  diferencia                DECIMAL(12,2),
  observaciones_apertura    VARCHAR(500),
  observaciones_cierre      VARCHAR(500),
  created_at                TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES "sucursal" (id) ON DELETE CASCADE,
  FOREIGN KEY (usuario_id) REFERENCES "usuario" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "caja_sesion_empresa_id_idx" ON "caja_sesion" (empresa_id);
CREATE INDEX IF NOT EXISTS "caja_sesion_sucursal_id_idx" ON "caja_sesion" (sucursal_id);
CREATE INDEX IF NOT EXISTS "caja_sesion_usuario_id_idx" ON "caja_sesion" (usuario_id);
CREATE INDEX IF NOT EXISTS "caja_sesion_estado_idx" ON "caja_sesion" (estado);
CREATE INDEX IF NOT EXISTS "caja_sesion_opened_at_idx" ON "caja_sesion" (opened_at);

CREATE TABLE IF NOT EXISTS "venta" (
  id                        BIGSERIAL PRIMARY KEY,
  public_id                 VARCHAR(30)              NOT NULL UNIQUE,
  empresa_id                BIGINT                   NOT NULL,
  sucursal_id               BIGINT,
  cliente_id                BIGINT,
  serie_comprobante_id      BIGINT                   NOT NULL,
  tipo_comprobante          "VentaTipoComprobante"   NOT NULL,
  serie                     VARCHAR(4)               NOT NULL,
  numero                    INTEGER                  NOT NULL,
  correlativo               VARCHAR(15)              NOT NULL,
  moneda                    VARCHAR(3)               NOT NULL DEFAULT 'PEN',
  forma_pago                VARCHAR(10)              NOT NULL DEFAULT 'CONTADO',
  descuento_tipo            "VentaDescuentoTipo",
  descuento_valor           DECIMAL(10,2),
  subtotal                  DECIMAL(12,2)            NOT NULL,
  descuento_monto           DECIMAL(12,2)            NOT NULL DEFAULT 0,
  igv_porcentaje            DECIMAL(5,2)             NOT NULL DEFAULT 18.00,
  op_gravadas               DECIMAL(12,2)            NOT NULL DEFAULT 0,
  op_exoneradas             DECIMAL(12,2)            NOT NULL DEFAULT 0,
  op_inafectas              DECIMAL(12,2)            NOT NULL DEFAULT 0,
  igv_monto                 DECIMAL(12,2)            NOT NULL DEFAULT 0,
  total                     DECIMAL(12,2)            NOT NULL,
  estado                    "VentaEstado"            NOT NULL DEFAULT 'completada',
  sunat_estado              "SunatEstado"            NOT NULL DEFAULT 'no_aplica',
  sunat_codigo              VARCHAR(20),
  sunat_mensaje             VARCHAR(500),
  sunat_hash                VARCHAR(120),
  sunat_xml_nombre          VARCHAR(180),
  sunat_xml_key             VARCHAR(600),
  sunat_zip_nombre          VARCHAR(180),
  sunat_zip_key             VARCHAR(600),
  sunat_cdr_nombre          VARCHAR(180),
  sunat_cdr_key             VARCHAR(600),
  sunat_enviado_at          TIMESTAMPTZ,
  sunat_respondido_at       TIMESTAMPTZ,
  tipo_anulacion            VARCHAR(20),
  sunat_baja_estado         "SunatBajaEstado",
  sunat_baja_codigo         VARCHAR(20),
  sunat_baja_mensaje        VARCHAR(500),
  sunat_baja_ticket         VARCHAR(120),
  sunat_baja_tipo           "SunatBajaTipo",
  sunat_baja_lote_id        BIGINT,
  sunat_baja_solicitada_at  TIMESTAMPTZ,
  sunat_baja_respondida_at  TIMESTAMPTZ,
  observaciones             VARCHAR(500),
  anulado_at                TIMESTAMPTZ,
  anulado_razon             VARCHAR(500),
  creado_por_id             BIGINT,
  caja_sesion_id            BIGINT,
  es_excedente_plan         BOOLEAN                  NOT NULL DEFAULT FALSE,
  precio_excedente_plan     DECIMAL(12,2),
  created_at                TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES "sucursal" (id) ON DELETE CASCADE,
  FOREIGN KEY (cliente_id) REFERENCES "cliente" (id) ON DELETE SET NULL,
  FOREIGN KEY (serie_comprobante_id) REFERENCES "serie_comprobante" (id) ON DELETE RESTRICT,
  FOREIGN KEY (creado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL,
  FOREIGN KEY (caja_sesion_id) REFERENCES "caja_sesion" (id) ON DELETE SET NULL,
  FOREIGN KEY (sunat_baja_lote_id) REFERENCES "sunat_baja_lote" (id) ON DELETE SET NULL,
  CONSTRAINT "venta_serie_comprobante_numero_key" UNIQUE (serie_comprobante_id, numero)
);
CREATE INDEX IF NOT EXISTS "venta_empresa_id_idx" ON "venta" (empresa_id);
CREATE INDEX IF NOT EXISTS "venta_empresa_tipo_comprobante_idx" ON "venta" (empresa_id, tipo_comprobante);
CREATE INDEX IF NOT EXISTS "venta_empresa_estado_idx" ON "venta" (empresa_id, estado);
CREATE INDEX IF NOT EXISTS "venta_empresa_estado_created_at_idx" ON "venta" (empresa_id, estado, created_at);
CREATE INDEX IF NOT EXISTS "venta_empresa_sucursal_estado_created_at_idx" ON "venta" (empresa_id, sucursal_id, estado, created_at);
CREATE INDEX IF NOT EXISTS "venta_empresa_creador_estado_created_at_idx" ON "venta" (empresa_id, creado_por_id, estado, created_at);
CREATE INDEX IF NOT EXISTS "venta_empresa_anulado_at_idx" ON "venta" (empresa_id, anulado_at);
CREATE INDEX IF NOT EXISTS "venta_empresa_excedente_created_at_idx" ON "venta" (empresa_id, es_excedente_plan, created_at);
CREATE INDEX IF NOT EXISTS "venta_empresa_sunat_estado_idx" ON "venta" (empresa_id, sunat_estado);
CREATE INDEX IF NOT EXISTS "venta_empresa_sunat_baja_estado_idx" ON "venta" (empresa_id, sunat_baja_estado);
CREATE INDEX IF NOT EXISTS "venta_sunat_baja_lote_id_idx" ON "venta" (sunat_baja_lote_id);
CREATE INDEX IF NOT EXISTS "venta_sucursal_id_idx" ON "venta" (sucursal_id);
CREATE INDEX IF NOT EXISTS "venta_cliente_id_idx" ON "venta" (cliente_id);
CREATE INDEX IF NOT EXISTS "venta_caja_sesion_id_idx" ON "venta" (caja_sesion_id);
CREATE INDEX IF NOT EXISTS "venta_serie_numero_idx" ON "venta" (serie, numero);
CREATE INDEX IF NOT EXISTS "venta_correlativo_idx" ON "venta" (correlativo);
CREATE INDEX IF NOT EXISTS "venta_created_at_idx" ON "venta" (created_at);

CREATE TABLE IF NOT EXISTS "sunat_baja_item" (
  id                BIGSERIAL PRIMARY KEY,
  lote_id           BIGINT                  NOT NULL,
  venta_id          BIGINT                  NOT NULL UNIQUE,
  tipo_comprobante  "VentaTipoComprobante"  NOT NULL,
  serie             VARCHAR(4)              NOT NULL,
  numero            INTEGER                 NOT NULL,
  fecha_documento   DATE                    NOT NULL,
  motivo            VARCHAR(255)            NOT NULL,
  created_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  FOREIGN KEY (lote_id) REFERENCES "sunat_baja_lote" (id) ON DELETE CASCADE,
  FOREIGN KEY (venta_id) REFERENCES "venta" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "sunat_baja_item_lote_id_idx" ON "sunat_baja_item" (lote_id);
CREATE INDEX IF NOT EXISTS "sunat_baja_item_fecha_documento_idx" ON "sunat_baja_item" (fecha_documento);

CREATE TABLE IF NOT EXISTS "venta_detalle" (
  id                          BIGSERIAL PRIMARY KEY,
  venta_id                    BIGINT              NOT NULL,
  producto_variante_id        BIGINT              NOT NULL,
  descripcion                 VARCHAR(255),
  cantidad                    INTEGER             NOT NULL,
  unidad_medida_codigo        VARCHAR(10)         NOT NULL DEFAULT 'NIU',
  tipo_afectacion_igv_codigo  VARCHAR(4)          NOT NULL DEFAULT '10',
  precio_unitario             DECIMAL(12,2)       NOT NULL,
  valor_unitario              DECIMAL(12,10)      NOT NULL DEFAULT 0,
  descuento_tipo              "VentaDescuentoTipo",
  descuento_valor             DECIMAL(10,2),
  descuento_monto             DECIMAL(12,2)       NOT NULL DEFAULT 0,
  valor_venta                 DECIMAL(12,2)       NOT NULL DEFAULT 0,
  igv_monto                   DECIMAL(12,2)       NOT NULL DEFAULT 0,
  subtotal                    DECIMAL(12,2)       NOT NULL,
  total                       DECIMAL(12,2)       NOT NULL,
  created_at                  TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  FOREIGN KEY (venta_id) REFERENCES "venta" (id) ON DELETE CASCADE,
  FOREIGN KEY (producto_variante_id) REFERENCES "producto_variante" (id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "venta_detalle_venta_id_idx" ON "venta_detalle" (venta_id);
CREATE INDEX IF NOT EXISTS "venta_detalle_producto_variante_id_idx" ON "venta_detalle" (producto_variante_id);

CREATE TABLE IF NOT EXISTS "venta_pago" (
  id                BIGSERIAL PRIMARY KEY,
  venta_id          BIGINT          NOT NULL,
  metodo_pago_id    BIGINT          NOT NULL,
  monto             DECIMAL(12,2)   NOT NULL,
  monto_recibido    DECIMAL(12,2),
  vuelto            DECIMAL(12,2)   NOT NULL DEFAULT 0,
  referencia        VARCHAR(200),
  estado            "VentaPagoEstado" NOT NULL DEFAULT 'activo',
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  FOREIGN KEY (venta_id) REFERENCES "venta" (id) ON DELETE CASCADE,
  FOREIGN KEY (metodo_pago_id) REFERENCES "metodo_pago" (id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "venta_pago_venta_id_idx" ON "venta_pago" (venta_id);
CREATE INDEX IF NOT EXISTS "venta_pago_metodo_pago_id_idx" ON "venta_pago" (metodo_pago_id);

CREATE TABLE IF NOT EXISTS "caja_movimiento" (
  id                BIGSERIAL PRIMARY KEY,
  public_id         VARCHAR(30)             NOT NULL UNIQUE,
  empresa_id        BIGINT                  NOT NULL,
  caja_sesion_id    BIGINT                  NOT NULL,
  venta_id          BIGINT,
  venta_pago_id     BIGINT,
  metodo_pago_id    BIGINT,
  tipo              "CajaMovimientoTipo"    NOT NULL,
  monto             DECIMAL(12,2)           NOT NULL,
  motivo            VARCHAR(500),
  referencia        VARCHAR(200),
  creado_por_id     BIGINT,
  created_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (caja_sesion_id) REFERENCES "caja_sesion" (id) ON DELETE CASCADE,
  FOREIGN KEY (venta_id) REFERENCES "venta" (id) ON DELETE SET NULL,
  FOREIGN KEY (venta_pago_id) REFERENCES "venta_pago" (id) ON DELETE SET NULL,
  FOREIGN KEY (metodo_pago_id) REFERENCES "metodo_pago" (id) ON DELETE RESTRICT,
  FOREIGN KEY (creado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "caja_movimiento_empresa_id_idx" ON "caja_movimiento" (empresa_id);
CREATE INDEX IF NOT EXISTS "caja_movimiento_caja_sesion_id_idx" ON "caja_movimiento" (caja_sesion_id);
CREATE INDEX IF NOT EXISTS "caja_movimiento_venta_id_idx" ON "caja_movimiento" (venta_id);
CREATE INDEX IF NOT EXISTS "caja_movimiento_venta_pago_id_idx" ON "caja_movimiento" (venta_pago_id);
CREATE INDEX IF NOT EXISTS "caja_movimiento_metodo_pago_id_idx" ON "caja_movimiento" (metodo_pago_id);
CREATE INDEX IF NOT EXISTS "caja_movimiento_tipo_idx" ON "caja_movimiento" (tipo);
CREATE INDEX IF NOT EXISTS "caja_movimiento_created_at_idx" ON "caja_movimiento" (created_at);

CREATE TABLE IF NOT EXISTS "cotizacion" (
  id                    BIGSERIAL PRIMARY KEY,
  public_id             VARCHAR(30)              NOT NULL UNIQUE,
  empresa_id            BIGINT                   NOT NULL,
  sucursal_id           BIGINT,
  cliente_id            BIGINT,
  serie                 VARCHAR(4)               NOT NULL,
  numero                INTEGER                  NOT NULL,
  correlativo           VARCHAR(15)              NOT NULL,
  estado                "CotizacionEstado"       NOT NULL DEFAULT 'borrador',
  descuento_tipo        "VentaDescuentoTipo",
  descuento_valor       DECIMAL(10,2),
  subtotal              DECIMAL(12,2)            NOT NULL,
  descuento_monto       DECIMAL(12,2)            NOT NULL DEFAULT 0,
  total                 DECIMAL(12,2)            NOT NULL,
  observaciones         VARCHAR(500),
  valida_hasta          TIMESTAMPTZ,
  convertida_venta_id   BIGINT                   UNIQUE,
  creado_por_id         BIGINT,
  anulado_at            TIMESTAMPTZ,
  anulado_razon         VARCHAR(500),
  created_at            TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES "sucursal" (id) ON DELETE CASCADE,
  FOREIGN KEY (cliente_id) REFERENCES "cliente" (id) ON DELETE SET NULL,
  FOREIGN KEY (convertida_venta_id) REFERENCES "venta" (id) ON DELETE SET NULL,
  FOREIGN KEY (creado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL,
  CONSTRAINT "cotizacion_empresa_serie_numero_key" UNIQUE (empresa_id, serie, numero)
);
CREATE INDEX IF NOT EXISTS "cotizacion_empresa_id_idx" ON "cotizacion" (empresa_id);
CREATE INDEX IF NOT EXISTS "cotizacion_empresa_estado_idx" ON "cotizacion" (empresa_id, estado);
CREATE INDEX IF NOT EXISTS "cotizacion_sucursal_id_idx" ON "cotizacion" (sucursal_id);
CREATE INDEX IF NOT EXISTS "cotizacion_cliente_id_idx" ON "cotizacion" (cliente_id);
CREATE INDEX IF NOT EXISTS "cotizacion_serie_numero_idx" ON "cotizacion" (serie, numero);
CREATE INDEX IF NOT EXISTS "cotizacion_correlativo_idx" ON "cotizacion" (correlativo);
CREATE INDEX IF NOT EXISTS "cotizacion_created_at_idx" ON "cotizacion" (created_at);
CREATE INDEX IF NOT EXISTS "cotizacion_valida_hasta_idx" ON "cotizacion" (valida_hasta);

CREATE TABLE IF NOT EXISTS "cotizacion_detalle" (
  id                      BIGSERIAL PRIMARY KEY,
  cotizacion_id           BIGINT              NOT NULL,
  producto_variante_id    BIGINT              NOT NULL,
  cantidad                INTEGER             NOT NULL,
  precio_unitario         DECIMAL(12,2)       NOT NULL,
  descuento_tipo          "VentaDescuentoTipo",
  descuento_valor         DECIMAL(10,2),
  descuento_monto         DECIMAL(12,2)       NOT NULL DEFAULT 0,
  subtotal                DECIMAL(12,2)       NOT NULL,
  total                   DECIMAL(12,2)       NOT NULL,
  created_at              TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  FOREIGN KEY (cotizacion_id) REFERENCES "cotizacion" (id) ON DELETE CASCADE,
  FOREIGN KEY (producto_variante_id) REFERENCES "producto_variante" (id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "cotizacion_detalle_cotizacion_id_idx" ON "cotizacion_detalle" (cotizacion_id);
CREATE INDEX IF NOT EXISTS "cotizacion_detalle_producto_variante_id_idx" ON "cotizacion_detalle" (producto_variante_id);

CREATE TABLE IF NOT EXISTS "nota_credito" (
  id                      BIGSERIAL PRIMARY KEY,
  public_id               VARCHAR(30)              NOT NULL UNIQUE,
  empresa_id              BIGINT                   NOT NULL,
  venta_referencia_id     BIGINT                   NOT NULL,
  sucursal_id             BIGINT,
  cliente_id              BIGINT,
  serie_comprobante_id    BIGINT                   NOT NULL,
  creado_por_id           BIGINT,
  tipo_comprobante        "VentaTipoComprobante"   NOT NULL,
  serie                   VARCHAR(4)               NOT NULL,
  numero                  INTEGER                  NOT NULL,
  correlativo             VARCHAR(15)              NOT NULL,
  moneda                  VARCHAR(3)               NOT NULL DEFAULT 'PEN',
  codigo_motivo           VARCHAR(2)               NOT NULL,
  descripcion_motivo      VARCHAR(255)             NOT NULL,
  tipo_documento_ref      VARCHAR(2)               NOT NULL,
  serie_ref               VARCHAR(4)               NOT NULL,
  numero_ref              INTEGER                  NOT NULL,
  correlativo_ref         VARCHAR(15)              NOT NULL,
  subtotal                DECIMAL(12,2)            NOT NULL,
  descuento_monto         DECIMAL(12,2)            NOT NULL DEFAULT 0,
  igv_porcentaje          DECIMAL(5,2)             NOT NULL DEFAULT 18.00,
  op_gravadas             DECIMAL(12,2)            NOT NULL DEFAULT 0,
  op_exoneradas           DECIMAL(12,2)            NOT NULL DEFAULT 0,
  op_inafectas            DECIMAL(12,2)            NOT NULL DEFAULT 0,
  igv_monto               DECIMAL(12,2)            NOT NULL DEFAULT 0,
  total                   DECIMAL(12,2)            NOT NULL,
  estado                  VARCHAR(20)              NOT NULL DEFAULT 'emitida',
  sunat_estado            "SunatEstado"            NOT NULL DEFAULT 'pendiente_envio',
  sunat_codigo            VARCHAR(20),
  sunat_mensaje           VARCHAR(500),
  sunat_hash              VARCHAR(120),
  sunat_xml_nombre        VARCHAR(180),
  sunat_xml_key           VARCHAR(600),
  sunat_zip_nombre        VARCHAR(180),
  sunat_zip_key           VARCHAR(600),
  sunat_cdr_nombre        VARCHAR(180),
  sunat_cdr_key           VARCHAR(600),
  sunat_pdf_nombre        VARCHAR(180),
  sunat_pdf_key           VARCHAR(600),
  sunat_enviado_at        TIMESTAMPTZ,
  sunat_respondido_at     TIMESTAMPTZ,
  stock_devuelto          BOOLEAN                  NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (venta_referencia_id) REFERENCES "venta" (id) ON DELETE RESTRICT,
  FOREIGN KEY (sucursal_id) REFERENCES "sucursal" (id) ON DELETE SET NULL,
  FOREIGN KEY (cliente_id) REFERENCES "cliente" (id) ON DELETE SET NULL,
  FOREIGN KEY (serie_comprobante_id) REFERENCES "serie_comprobante" (id) ON DELETE RESTRICT,
  FOREIGN KEY (creado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL,
  CONSTRAINT "nota_credito_serie_comprobante_numero_key" UNIQUE (serie_comprobante_id, numero)
);
CREATE INDEX IF NOT EXISTS "nota_credito_empresa_id_idx" ON "nota_credito" (empresa_id);
CREATE INDEX IF NOT EXISTS "nota_credito_venta_referencia_id_idx" ON "nota_credito" (venta_referencia_id);
CREATE INDEX IF NOT EXISTS "nota_credito_empresa_sunat_estado_idx" ON "nota_credito" (empresa_id, sunat_estado);
CREATE INDEX IF NOT EXISTS "nota_credito_cliente_id_idx" ON "nota_credito" (cliente_id);
CREATE INDEX IF NOT EXISTS "nota_credito_sucursal_id_idx" ON "nota_credito" (sucursal_id);
CREATE INDEX IF NOT EXISTS "nota_credito_serie_numero_idx" ON "nota_credito" (serie, numero);
CREATE INDEX IF NOT EXISTS "nota_credito_correlativo_idx" ON "nota_credito" (correlativo);
CREATE INDEX IF NOT EXISTS "nota_credito_created_at_idx" ON "nota_credito" (created_at);

CREATE TABLE IF NOT EXISTS "nota_credito_detalle" (
  id                              BIGSERIAL PRIMARY KEY,
  nota_credito_id                 BIGINT          NOT NULL,
  venta_detalle_referencia_id     BIGINT,
  producto_variante_id            BIGINT          NOT NULL,
  descripcion                     VARCHAR(255),
  cantidad                        INTEGER         NOT NULL,
  unidad_medida_codigo            VARCHAR(10)     NOT NULL DEFAULT 'NIU',
  tipo_afectacion_igv_codigo      VARCHAR(4)      NOT NULL DEFAULT '10',
  precio_unitario                 DECIMAL(12,2)   NOT NULL,
  valor_unitario                  DECIMAL(12,10)  NOT NULL DEFAULT 0,
  descuento_monto                 DECIMAL(12,2)   NOT NULL DEFAULT 0,
  valor_venta                     DECIMAL(12,2)   NOT NULL DEFAULT 0,
  igv_monto                       DECIMAL(12,2)   NOT NULL DEFAULT 0,
  subtotal                        DECIMAL(12,2)   NOT NULL,
  total                           DECIMAL(12,2)   NOT NULL,
  created_at                      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  FOREIGN KEY (nota_credito_id) REFERENCES "nota_credito" (id) ON DELETE CASCADE,
  FOREIGN KEY (venta_detalle_referencia_id) REFERENCES "venta_detalle" (id) ON DELETE SET NULL,
  FOREIGN KEY (producto_variante_id) REFERENCES "producto_variante" (id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "nota_credito_detalle_nota_credito_id_idx" ON "nota_credito_detalle" (nota_credito_id);
CREATE INDEX IF NOT EXISTS "nota_credito_detalle_venta_detalle_ref_idx" ON "nota_credito_detalle" (venta_detalle_referencia_id);
CREATE INDEX IF NOT EXISTS "nota_credito_detalle_producto_variante_id_idx" ON "nota_credito_detalle" (producto_variante_id);

CREATE TABLE IF NOT EXISTS "guia_remision" (
  id                            BIGSERIAL PRIMARY KEY,
  public_id                     VARCHAR(30)                     NOT NULL UNIQUE,
  empresa_id                    BIGINT                          NOT NULL,
  sucursal_id                   BIGINT                          NOT NULL,
  creado_por_id                 BIGINT,
  serie_comprobante_id          BIGINT                          NOT NULL,
  serie                         VARCHAR(4)                      NOT NULL,
  numero                        INTEGER                         NOT NULL,
  correlativo                   VARCHAR(15)                     NOT NULL,
  fecha_emision                 DATE                            NOT NULL DEFAULT NOW(),
  fecha_inicio_traslado         DATE                            NOT NULL,
  fecha_entrega_transportista   DATE,
  motivo_traslado               VARCHAR(2)                      NOT NULL DEFAULT '04',
  descripcion_motivo            VARCHAR(255),
  modalidad_transporte          VARCHAR(2)                      NOT NULL,
  peso_bruto_total              DECIMAL(12,3)                   NOT NULL,
  unidad_peso                   VARCHAR(3)                      NOT NULL DEFAULT 'KGM',
  numero_bultos                 INTEGER,
  observaciones                 VARCHAR(500),
  sucursal_partida_id           BIGINT,
  ubigeo_partida                VARCHAR(6)                      NOT NULL,
  direccion_partida             VARCHAR(255)                    NOT NULL,
  sucursal_llegada_id           BIGINT,
  ubigeo_llegada                VARCHAR(6)                      NOT NULL,
  direccion_llegada             VARCHAR(255)                    NOT NULL,
  destinatario_tipo_doc         VARCHAR(1)                      NOT NULL,
  destinatario_nro_doc          VARCHAR(20)                     NOT NULL,
  destinatario_razon_social     VARCHAR(200)                    NOT NULL,
  estado                        "GuiaRemisionEstado"            NOT NULL DEFAULT 'borrador',
  sunat_estado                  "SunatEstado"                   NOT NULL DEFAULT 'no_aplica',
  sunat_codigo                  VARCHAR(20),
  sunat_mensaje                 VARCHAR(500),
  sunat_hash                    VARCHAR(120),
  sunat_ticket                  VARCHAR(120),
  sunat_xml_nombre              VARCHAR(180),
  sunat_xml_key                 VARCHAR(600),
  sunat_zip_nombre              VARCHAR(180),
  sunat_zip_key                 VARCHAR(600),
  sunat_cdr_nombre              VARCHAR(180),
  sunat_cdr_key                 VARCHAR(600),
  sunat_pdf_nombre              VARCHAR(180),
  sunat_pdf_key                 VARCHAR(600),
  sunat_enviado_at              TIMESTAMPTZ,
  sunat_respondido_at           TIMESTAMPTZ,
  anulado_at                    TIMESTAMPTZ,
  anulado_razon                 VARCHAR(500),
  created_at                    TIMESTAMPTZ                     NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ                     NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (sucursal_id) REFERENCES "sucursal" (id) ON DELETE RESTRICT,
  FOREIGN KEY (sucursal_partida_id) REFERENCES "sucursal" (id) ON DELETE SET NULL,
  FOREIGN KEY (sucursal_llegada_id) REFERENCES "sucursal" (id) ON DELETE SET NULL,
  FOREIGN KEY (creado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL,
  FOREIGN KEY (serie_comprobante_id) REFERENCES "serie_comprobante" (id) ON DELETE RESTRICT,
  CONSTRAINT "guia_remision_serie_comprobante_numero_key" UNIQUE (serie_comprobante_id, numero)
);
CREATE INDEX IF NOT EXISTS "guia_remision_empresa_id_idx" ON "guia_remision" (empresa_id);
CREATE INDEX IF NOT EXISTS "guia_remision_empresa_estado_idx" ON "guia_remision" (empresa_id, estado);
CREATE INDEX IF NOT EXISTS "guia_remision_empresa_sunat_estado_idx" ON "guia_remision" (empresa_id, sunat_estado);
CREATE INDEX IF NOT EXISTS "guia_remision_sucursal_id_idx" ON "guia_remision" (sucursal_id);
CREATE INDEX IF NOT EXISTS "guia_remision_sucursal_partida_id_idx" ON "guia_remision" (sucursal_partida_id);
CREATE INDEX IF NOT EXISTS "guia_remision_sucursal_llegada_id_idx" ON "guia_remision" (sucursal_llegada_id);
CREATE INDEX IF NOT EXISTS "guia_remision_serie_numero_idx" ON "guia_remision" (serie, numero);
CREATE INDEX IF NOT EXISTS "guia_remision_correlativo_idx" ON "guia_remision" (correlativo);
CREATE INDEX IF NOT EXISTS "guia_remision_created_at_idx" ON "guia_remision" (created_at);

CREATE TABLE IF NOT EXISTS "guia_remision_detalle" (
  id                      BIGSERIAL PRIMARY KEY,
  guia_remision_id        BIGINT          NOT NULL,
  producto_variante_id    BIGINT,
  descripcion             VARCHAR(255)    NOT NULL,
  cantidad                DECIMAL(12,3)   NOT NULL,
  unidad_medida           VARCHAR(3)      NOT NULL DEFAULT 'NIU',
  codigo_producto         VARCHAR(50),
  peso_unitario           DECIMAL(12,3),
  created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  FOREIGN KEY (guia_remision_id) REFERENCES "guia_remision" (id) ON DELETE CASCADE,
  FOREIGN KEY (producto_variante_id) REFERENCES "producto_variante" (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "guia_remision_detalle_guia_remision_id_idx" ON "guia_remision_detalle" (guia_remision_id);
CREATE INDEX IF NOT EXISTS "guia_remision_detalle_producto_variante_id_idx" ON "guia_remision_detalle" (producto_variante_id);

CREATE TABLE IF NOT EXISTS "guia_remision_documento_relacionado" (
  id                BIGSERIAL PRIMARY KEY,
  guia_remision_id  BIGINT       NOT NULL,
  tipo_documento    VARCHAR(2)   NOT NULL,
  serie             VARCHAR(4)   NOT NULL,
  numero            VARCHAR(20)  NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (guia_remision_id) REFERENCES "guia_remision" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "guia_remision_doc_rel_guia_remision_id_idx" ON "guia_remision_documento_relacionado" (guia_remision_id);
CREATE INDEX IF NOT EXISTS "guia_remision_doc_rel_tipo_serie_numero_idx" ON "guia_remision_documento_relacionado" (tipo_documento, serie, numero);

CREATE TABLE IF NOT EXISTS "guia_remision_transporte_participante" (
  id                BIGSERIAL PRIMARY KEY,
  guia_remision_id  BIGINT                              NOT NULL,
  tipo              "GuiaRemisionParticipanteTipo"       NOT NULL,
  tipo_documento    VARCHAR(1)                           NOT NULL,
  numero_documento  VARCHAR(20)                          NOT NULL,
  nombres           VARCHAR(120),
  apellidos         VARCHAR(120),
  razon_social      VARCHAR(200),
  licencia          VARCHAR(20),
  registro_mtc      VARCHAR(20),
  es_principal      BOOLEAN                             NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ                         NOT NULL DEFAULT NOW(),
  FOREIGN KEY (guia_remision_id) REFERENCES "guia_remision" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "guia_remision_transporte_part_guia_id_idx" ON "guia_remision_transporte_participante" (guia_remision_id);
CREATE INDEX IF NOT EXISTS "guia_remision_transporte_part_tipo_idx" ON "guia_remision_transporte_participante" (tipo);

CREATE TABLE IF NOT EXISTS "guia_remision_vehiculo" (
  id                BIGSERIAL PRIMARY KEY,
  guia_remision_id  BIGINT       NOT NULL,
  placa             VARCHAR(10)  NOT NULL,
  es_principal      BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (guia_remision_id) REFERENCES "guia_remision" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "guia_remision_vehiculo_guia_id_idx" ON "guia_remision_vehiculo" (guia_remision_id);
CREATE INDEX IF NOT EXISTS "guia_remision_vehiculo_placa_idx" ON "guia_remision_vehiculo" (placa);

-- Tier 6: Payment / Affiliate / Platform billing (most complex deps)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "pago_suscripcion" (
  id                                BIGSERIAL PRIMARY KEY,
  request_id                        UUID                NOT NULL UNIQUE,
  empresa_id                        BIGINT              NOT NULL,
  registrado_por_id                 BIGINT              NOT NULL,
  anulado_por_id                    BIGINT,
  plan_codigo                       "PlanCodigo"        NOT NULL,
  meses                             INTEGER             NOT NULL,
  precio_mensual                    DECIMAL(12,2)       NOT NULL,
  monto_lista                       DECIMAL(12,2)       NOT NULL,
  descuento_porcentaje              DECIMAL(5,2)        NOT NULL DEFAULT 0,
  monto_descuento                   DECIMAL(12,2)       NOT NULL DEFAULT 0,
  monto_total                       DECIMAL(12,2)       NOT NULL,
  afiliado_id                       BIGINT,
  afiliado_codigo                   VARCHAR(30),
  descuento_afiliado_porcentaje     DECIMAL(5,2)        NOT NULL DEFAULT 0,
  monto_descuento_afiliado          DECIMAL(12,2)       NOT NULL DEFAULT 0,
  base_comision_afiliado            DECIMAL(12,2)       NOT NULL DEFAULT 0,
  comision_afiliado_porcentaje      DECIMAL(5,2)        NOT NULL DEFAULT 0,
  monto_comision_afiliado           DECIMAL(12,2)       NOT NULL DEFAULT 0,
  moneda                            VARCHAR(3)          NOT NULL DEFAULT 'PEN',
  incluye_igv                       BOOLEAN             NOT NULL DEFAULT TRUE,
  metodo_pago                       "PagoSuscripcionMetodo" NOT NULL,
  metodo_pago_otro                  VARCHAR(80),
  estado                            "PagoSuscripcionEstado" NOT NULL DEFAULT 'pagado',
  plan_anterior_codigo              "PlanCodigo"        NOT NULL,
  plan_anterior_inicio_at           TIMESTAMPTZ         NOT NULL,
  plan_anterior_fin_at              TIMESTAMPTZ,
  vigencia_inicio_at                TIMESTAMPTZ         NOT NULL,
  vigencia_fin_at                   TIMESTAMPTZ         NOT NULL,
  plan_resultante_inicio_at         TIMESTAMPTZ         NOT NULL,
  plan_resultante_fin_at            TIMESTAMPTZ         NOT NULL,
  motivo_anulacion                  VARCHAR(300),
  anulado_at                        TIMESTAMPTZ,
  created_at                        TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE RESTRICT,
  FOREIGN KEY (registrado_por_id) REFERENCES "usuario" (id) ON DELETE RESTRICT,
  FOREIGN KEY (anulado_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL,
  FOREIGN KEY (afiliado_id) REFERENCES "afiliado" (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "pago_suscripcion_empresa_created_at_idx" ON "pago_suscripcion" (empresa_id, created_at);
CREATE INDEX IF NOT EXISTS "pago_suscripcion_estado_created_at_idx" ON "pago_suscripcion" (estado, created_at);
CREATE INDEX IF NOT EXISTS "pago_suscripcion_plan_created_at_idx" ON "pago_suscripcion" (plan_codigo, created_at);
CREATE INDEX IF NOT EXISTS "pago_suscripcion_metodo_created_at_idx" ON "pago_suscripcion" (metodo_pago, created_at);
CREATE INDEX IF NOT EXISTS "pago_suscripcion_registrado_por_created_at_idx" ON "pago_suscripcion" (registrado_por_id, created_at);
CREATE INDEX IF NOT EXISTS "pago_suscripcion_afiliado_created_at_idx" ON "pago_suscripcion" (afiliado_id, created_at);

CREATE TABLE IF NOT EXISTS "empresa_afiliacion" (
  empresa_id        BIGINT                       NOT NULL PRIMARY KEY,
  afiliado_id       BIGINT                       NOT NULL,
  primer_pago_id    BIGINT                       UNIQUE,
  estado            "EmpresaAfiliacionEstado"    NOT NULL DEFAULT 'activa',
  iniciada_at       TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
  interrumpida_at   TIMESTAMPTZ,
  motivo_fin        VARCHAR(200),
  updated_at        TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE CASCADE,
  FOREIGN KEY (afiliado_id) REFERENCES "afiliado" (id) ON DELETE RESTRICT,
  FOREIGN KEY (primer_pago_id) REFERENCES "pago_suscripcion" (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "empresa_afiliacion_afiliado_estado_idx" ON "empresa_afiliacion" (afiliado_id, estado);

CREATE TABLE IF NOT EXISTS "liquidacion_excedente" (
  id                  BIGSERIAL PRIMARY KEY,
  request_id          UUID                            NOT NULL UNIQUE,
  pago_request_id     UUID                            UNIQUE,
  empresa_id          BIGINT                          NOT NULL,
  periodo             VARCHAR(7)                      NOT NULL,
  cantidad            INTEGER                         NOT NULL,
  monto_total         DECIMAL(12,2)                   NOT NULL,
  moneda              VARCHAR(3)                      NOT NULL DEFAULT 'PEN',
  incluye_igv         BOOLEAN                         NOT NULL DEFAULT TRUE,
  estado              "LiquidacionExcedenteEstado"    NOT NULL DEFAULT 'pendiente',
  metodo_pago         "PagoSuscripcionMetodo",
  metodo_pago_otro    VARCHAR(80),
  cerrada_por_id      BIGINT                          NOT NULL,
  pagada_por_id       BIGINT,
  pagado_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ                     NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ                     NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE RESTRICT,
  FOREIGN KEY (cerrada_por_id) REFERENCES "usuario" (id) ON DELETE RESTRICT,
  FOREIGN KEY (pagada_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL,
  CONSTRAINT "liquidacion_excedente_empresa_periodo_key" UNIQUE (empresa_id, periodo)
);
CREATE INDEX IF NOT EXISTS "liquidacion_excedente_estado_created_at_idx" ON "liquidacion_excedente" (estado, created_at);
CREATE INDEX IF NOT EXISTS "liquidacion_excedente_empresa_created_at_idx" ON "liquidacion_excedente" (empresa_id, created_at);

CREATE TABLE IF NOT EXISTS "liquidacion_afiliado" (
  id                  BIGSERIAL PRIMARY KEY,
  request_id          UUID                             NOT NULL UNIQUE,
  pago_request_id     UUID                             UNIQUE,
  afiliado_id         BIGINT                           NOT NULL,
  periodo             VARCHAR(7)                       NOT NULL,
  cantidad            INTEGER                          NOT NULL,
  monto_total         DECIMAL(12,2)                    NOT NULL,
  estado              "LiquidacionAfiliadoEstado"      NOT NULL DEFAULT 'pendiente',
  metodo_pago         "PagoSuscripcionMetodo",
  referencia_pago     VARCHAR(120),
  cerrada_por_id      BIGINT                           NOT NULL,
  pagada_por_id       BIGINT,
  pagado_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ                      NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ                      NOT NULL DEFAULT NOW(),
  FOREIGN KEY (afiliado_id) REFERENCES "afiliado" (id) ON DELETE RESTRICT,
  FOREIGN KEY (cerrada_por_id) REFERENCES "usuario" (id) ON DELETE RESTRICT,
  FOREIGN KEY (pagada_por_id) REFERENCES "usuario" (id) ON DELETE SET NULL,
  CONSTRAINT "liquidacion_afiliado_afiliado_periodo_key" UNIQUE (afiliado_id, periodo)
);
CREATE INDEX IF NOT EXISTS "liquidacion_afiliado_estado_created_at_idx" ON "liquidacion_afiliado" (estado, created_at);

CREATE TABLE IF NOT EXISTS "comision_afiliado" (
  id                    BIGSERIAL PRIMARY KEY,
  afiliado_id           BIGINT                       NOT NULL,
  empresa_id            BIGINT                       NOT NULL,
  pago_suscripcion_id   BIGINT                       NOT NULL,
  liquidacion_id        BIGINT,
  tipo                  "ComisionAfiliadoTipo"       NOT NULL DEFAULT 'venta',
  periodo               VARCHAR(7)                   NOT NULL,
  base_calculo          DECIMAL(12,2)                NOT NULL,
  porcentaje            DECIMAL(5,2)                 NOT NULL,
  monto                 DECIMAL(12,2)                NOT NULL,
  estado                "ComisionAfiliadoEstado"     NOT NULL DEFAULT 'pendiente',
  created_at            TIMESTAMPTZ                  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (afiliado_id) REFERENCES "afiliado" (id) ON DELETE RESTRICT,
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE RESTRICT,
  FOREIGN KEY (pago_suscripcion_id) REFERENCES "pago_suscripcion" (id) ON DELETE RESTRICT,
  FOREIGN KEY (liquidacion_id) REFERENCES "liquidacion_afiliado" (id) ON DELETE SET NULL,
  CONSTRAINT "comision_afiliado_pago_tipo_key" UNIQUE (pago_suscripcion_id, tipo)
);
CREATE INDEX IF NOT EXISTS "comision_afiliado_afiliado_periodo_estado_idx" ON "comision_afiliado" (afiliado_id, periodo, estado);
CREATE INDEX IF NOT EXISTS "comision_afiliado_empresa_created_at_idx" ON "comision_afiliado" (empresa_id, created_at);
CREATE INDEX IF NOT EXISTS "comision_afiliado_liquidacion_id_idx" ON "comision_afiliado" (liquidacion_id);

CREATE TABLE IF NOT EXISTS "cobro_adicional_plataforma" (
  id                  BIGSERIAL PRIMARY KEY,
  request_id          UUID                       NOT NULL UNIQUE,
  empresa_id          BIGINT                     NOT NULL,
  registrado_por_id   BIGINT                     NOT NULL,
  descripcion         VARCHAR(300)               NOT NULL,
  cantidad            DECIMAL(12,3)              NOT NULL,
  precio_unitario     DECIMAL(12,2)              NOT NULL,
  monto_total         DECIMAL(12,2)              NOT NULL,
  moneda              VARCHAR(3)                 NOT NULL DEFAULT 'PEN',
  incluye_igv         BOOLEAN                    NOT NULL DEFAULT TRUE,
  metodo_pago         "PagoSuscripcionMetodo"    NOT NULL,
  metodo_pago_otro    VARCHAR(80),
  estado              "CobroAdicionalEstado"     NOT NULL DEFAULT 'pagado',
  motivo_anulacion    VARCHAR(300),
  anulado_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE RESTRICT,
  FOREIGN KEY (registrado_por_id) REFERENCES "usuario" (id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "cobro_adicional_empresa_created_at_idx" ON "cobro_adicional_plataforma" (empresa_id, created_at);
CREATE INDEX IF NOT EXISTS "cobro_adicional_estado_created_at_idx" ON "cobro_adicional_plataforma" (estado, created_at);

CREATE TABLE IF NOT EXISTS "comprobante_plataforma" (
  id                           BIGSERIAL PRIMARY KEY,
  request_id                   UUID                             NOT NULL UNIQUE,
  empresa_id                   BIGINT                           NOT NULL,
  creado_por_id                BIGINT                           NOT NULL,
  serie_id                     BIGINT                           NOT NULL,
  pago_suscripcion_id          BIGINT                           UNIQUE,
  liquidacion_excedente_id     BIGINT                           UNIQUE,
  cobro_adicional_id           BIGINT                           UNIQUE,
  comprobante_origen_id        BIGINT                           UNIQUE,
  tipo                         "PlataformaComprobanteTipo"      NOT NULL,
  serie                        VARCHAR(4)                       NOT NULL,
  numero                       INTEGER                          NOT NULL,
  fecha_emision                TIMESTAMPTZ                      NOT NULL DEFAULT NOW(),
  receptor_tipo_documento      VARCHAR(2),
  receptor_documento           VARCHAR(20),
  receptor_nombre              VARCHAR(200)                     NOT NULL,
  receptor_direccion           TEXT,
  moneda                       VARCHAR(3)                       NOT NULL DEFAULT 'PEN',
  base_imponible               DECIMAL(12,2)                    NOT NULL,
  igv                          DECIMAL(12,2)                    NOT NULL,
  total                        DECIMAL(12,2)                    NOT NULL,
  estado                       "PlataformaComprobanteEstado"    NOT NULL DEFAULT 'pendiente',
  sunat_codigo                 VARCHAR(20),
  sunat_mensaje                TEXT,
  xml_r2_key                   VARCHAR(600),
  cdr_r2_key                   VARCHAR(600),
  pdf_r2_key                   VARCHAR(600),
  motivo_nota_credito          VARCHAR(300),
  sunat_baja_request_id        UUID                             UNIQUE,
  sunat_baja_estado            "SunatBajaEstado",
  sunat_baja_tipo              "SunatBajaTipo",
  sunat_baja_correlativo       INTEGER,
  sunat_baja_motivo            VARCHAR(300),
  sunat_baja_codigo            VARCHAR(20),
  sunat_baja_mensaje           VARCHAR(500),
  sunat_baja_ticket            VARCHAR(120),
  sunat_baja_xml_r2_key        VARCHAR(600),
  sunat_baja_cdr_r2_key        VARCHAR(600),
  sunat_baja_solicitada_at     TIMESTAMPTZ,
  sunat_baja_respondida_at     TIMESTAMPTZ,
  created_at                   TIMESTAMPTZ                      NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ                      NOT NULL DEFAULT NOW(),
  FOREIGN KEY (empresa_id) REFERENCES "empresa" (id) ON DELETE RESTRICT,
  FOREIGN KEY (creado_por_id) REFERENCES "usuario" (id) ON DELETE RESTRICT,
  FOREIGN KEY (serie_id) REFERENCES "serie_comprobante_plataforma" (id) ON DELETE RESTRICT,
  FOREIGN KEY (pago_suscripcion_id) REFERENCES "pago_suscripcion" (id) ON DELETE RESTRICT,
  FOREIGN KEY (liquidacion_excedente_id) REFERENCES "liquidacion_excedente" (id) ON DELETE RESTRICT,
  FOREIGN KEY (cobro_adicional_id) REFERENCES "cobro_adicional_plataforma" (id) ON DELETE RESTRICT,
  FOREIGN KEY (comprobante_origen_id) REFERENCES "comprobante_plataforma" (id) ON DELETE RESTRICT,
  CONSTRAINT "comprobante_plataforma_serie_numero_key" UNIQUE (serie, numero)
);
CREATE INDEX IF NOT EXISTS "comprobante_plataforma_empresa_fecha_idx" ON "comprobante_plataforma" (empresa_id, fecha_emision);
CREATE INDEX IF NOT EXISTS "comprobante_plataforma_tipo_estado_fecha_idx" ON "comprobante_plataforma" (tipo, estado, fecha_emision);
CREATE INDEX IF NOT EXISTS "comprobante_plataforma_baja_estado_solicitada_idx" ON "comprobante_plataforma" (sunat_baja_estado, sunat_baja_solicitada_at);

CREATE TABLE IF NOT EXISTS "comprobante_plataforma_detalle" (
  id                BIGSERIAL PRIMARY KEY,
  comprobante_id    BIGINT          NOT NULL,
  descripcion       VARCHAR(300)    NOT NULL,
  cantidad          DECIMAL(12,3)   NOT NULL,
  precio_unitario   DECIMAL(12,2)   NOT NULL,
  base_imponible    DECIMAL(12,2)   NOT NULL,
  igv               DECIMAL(12,2)   NOT NULL,
  total             DECIMAL(12,2)   NOT NULL,
  FOREIGN KEY (comprobante_id) REFERENCES "comprobante_plataforma" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "comprobante_plataforma_detalle_comprobante_id_idx" ON "comprobante_plataforma_detalle" (comprobante_id);

CREATE TABLE IF NOT EXISTS "comprobante_plataforma_sunat_job" (
  id                    BIGSERIAL PRIMARY KEY,
  comprobante_id        BIGINT                            NOT NULL UNIQUE,
  estado                "PlataformaSunatJobEstado"        NOT NULL DEFAULT 'pendiente',
  operacion             "PlataformaSunatJobOperacion"     NOT NULL DEFAULT 'emision',
  intentos              INTEGER                           NOT NULL DEFAULT 0,
  siguiente_intento_at  TIMESTAMPTZ,
  ultimo_error          TEXT,
  created_at            TIMESTAMPTZ                       NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ                       NOT NULL DEFAULT NOW(),
  FOREIGN KEY (comprobante_id) REFERENCES "comprobante_plataforma" (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "comprobante_plataforma_sunat_job_estado_siguiente_idx" ON "comprobante_plataforma_sunat_job" (estado, siguiente_intento_at);

-- ============================================================================
-- SEED DATA
-- ============================================================================

INSERT INTO "rol" (codigo, nombre, descripcion) VALUES 
  ('OWNER', 'Propietario', 'Dueño de la empresa con acceso total'),
  ('ADMIN', 'Administrador', 'Administra usuarios y configuraciones de la empresa'),
  ('VENDEDOR', 'Vendedor', 'Gestiona ventas y clientes'),
  ('ALMACENERO', 'Almacenero', 'Gestiona stock, productos y almacenes')
ON CONFLICT DO NOTHING;

INSERT INTO "tarifa_plan" ("plan_codigo", "precio_mensual", "descuento_mensual_porcentaje", "descuento_anual_porcentaje") VALUES
  ('prueba', 0.00, 0.00, 0.00),
  ('basico', 39.00, 0.00, 10.00),
  ('emprendedor', 79.00, 0.00, 10.00),
  ('crecimiento', 149.00, 0.00, 10.00),
  ('empresarial', 299.00, 0.00, 10.00)
ON CONFLICT ("plan_codigo") DO NOTHING;

INSERT INTO "limite_plan" ("plan_codigo", "usuarios", "sucursales", "almacenes", "productos", "variantes", "comprobantes", "consultas_documento", "almacenamiento_bytes") VALUES
  ('prueba',   1,  1, 5,    50,   500,   100,  20,   524288000),
  ('basico',   1,  1, 5,   100,  1000,   250,  50,  3221225472),
  ('emprendedor', 3, 2, 5, 450,  5000,  1000, 250, 10737418240),
  ('crecimiento', 10, 3, NULL, 4500, 45000, 5000, 1500, 53687091200),
  ('empresarial', 30, 20, NULL, 20000, 200000, 20000, 5000, 214748364800)
ON CONFLICT ("plan_codigo") DO NOTHING;

INSERT INTO "tarifa_comprobante_excedente" ("id", "precio_unitario") VALUES (1, 0.20)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PRISMA MIGRATIONS TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    id                  VARCHAR(36) PRIMARY KEY,
    checksum            VARCHAR(64) NOT NULL,
    finished_at         TIMESTAMPTZ,
    migration_name      VARCHAR(255) NOT NULL,
    logs                TEXT,
    rolled_back_at      TIMESTAMPTZ,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_steps_count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES
('a1000000-0000-0000-0000-000000000001', 'init', '20260520164856_init_access', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000002', 'init', '20260520190326_add_pending_registration', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000003', 'init', '20260520223413_add_company_onboarding_fields', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000004', 'init', '20260521170842_add_password_reset_tokens', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000005', 'init', '20260521181500_one_user_one_company', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000006', 'init', '20260521190000_add_colors', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000007', 'init', '20260521201000_add_sizes', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000008', 'init', '20260521204500_add_brands', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000009', 'init', '20260521212000_add_categories', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000010', 'init', '20260521223000_add_branches', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000011', 'init', '20260521231000_add_clients', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000012', 'init', '20260522020345_add_products', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000013', 'init', '20260523004705_add_metodo_pago', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000014', 'init', '20260523010000_remove_tipo_from_metodo_pago', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000015', 'init', '20260523020000_add_product_public_id', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000016', 'init', '20260524000000_add_ventas_module', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000017', 'init', '20260525000000_add_quotations_module', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000018', 'init', '20260526000000_add_company_pdf_logo', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000019', 'init', '20260526093000_add_cash_register_mode', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000020', 'init', '20260526103000_add_default_payment_methods_and_change', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000021', 'init', '20260527000000_add_series_branch_assignments', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000022', 'init', '20260528000000_add_sunat_config', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000023', 'init', '20260528010000_move_sunat_urls_to_global_config', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000024', 'init', '20260528020000_add_sunat_emission_sales', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000025', 'init', '20260602000000_add_sunat_baja_sales', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000026', 'init', '20260603010000_add_guia_remision_module', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000027', 'init', '20260603020000_backfill_guia_remision_series', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000028', 'init', '20260718000000_add_user_module_access', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000029', 'init', '20260719000000_add_credit_notes', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000030', 'init', '20260721000000_add_empresa_dni', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000031', 'init', '20260725010000_add_report_query_indexes', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000032', 'init', '20260730010000_add_company_plans', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000033', 'init', '20260730020000_add_platform_audit_log', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000034', 'init', '20260730030000_add_platform_admin_flag', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000035', 'init', '20260730040000_add_subscription_payments', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000036', 'init', '20260730050000_add_plan_pricing', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000037', 'init', '20260731010000_add_custom_limits_and_overages', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000038', 'init', '20260731020000_add_platform_billing', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000039', 'init', '20260731030000_add_editable_plan_limits', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000040', 'init', '20260731040000_add_notifications', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000041', 'init', '20260801010000_add_platform_sunat_cancellation', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000042', 'init', '20260801020000_remove_company_product_classification', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000043', 'init', '20260801030000_add_simple_products', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000044', 'init', '20260801040000_add_user_commercial_scope', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000045', 'init', '20260801050000_add_default_company_catalogs', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000046', 'init', '20260801060000_add_document_query_limits', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000047', 'init', '20260802010000_add_affiliates', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000048', 'init', '20260802020000_add_basic_plan_monthly_discount', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000049', 'init', '20260802021000_add_basic_plan_pricing', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000050', 'init', '20260802030000_add_warehouse_plan_limits', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000051', 'init', '20260803010000_add_default_credit_note_series', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000052', 'init', '20260803020000_add_stock_movements', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000053', 'init', '20260804010000_update_commercial_plans', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000054', 'init', '20260804020000_add_login_attempts', NOW(), NOW(), 1),
('a1000000-0000-0000-0000-000000000055', 'init', '20260804030000_enable_sunat_gre_rest', NOW(), NOW(), 1)
ON CONFLICT DO NOTHING;
