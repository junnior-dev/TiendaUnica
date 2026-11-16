-- =============================================================
--  31_tienda_unica.sql
--  Convierte el sistema multi-tenant en tienda única
-- =============================================================
--  Este archivo puede ejecutarse sobre una base tienda ya instalada:
--     psql -U postgres -d tienda -v ON_ERROR_STOP=1 -f database/sql/31_tienda_unica.sql
--
--  Qué hace:
--   · fn_negocio_actual() siempre devuelve 1
--   · fn_sesion_permitida() y fn_puede_editar_global() siempre devuelven true
--   · Pone DEFAULT 1 en todas las columnas negocio_id y conserva trg_sello_negocio
--     (CRÍTICO: CategoriasController, MarcasController, ModelosController,
--      MetodosPagoController, ProductosController, CierreCajaController y
--      trg_productos_despues hacen INSERT sin negocio_id explícito)
--   · Desactiva RLS en las tablas de negocio Y en tienda.negocio
--   · Elimina estado_tenants, plataforma_admin y plataforma_roles
--   · Limpia privilegios (DROP OWNED) antes de eliminar el rol saas_app
-- =============================================================

SET search_path = tienda, public;

-- -------------------------------------------------------------------
--  1. FUNCIONES DE SESIÓN Y GUARDIA SIMPLIFICADAS
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_negocio_actual() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT 1
$$;
COMMENT ON FUNCTION fn_negocio_actual() IS 'Tienda única: siempre devuelve 1. La sesión no necesita declarar negocio_id.';

CREATE OR REPLACE FUNCTION fn_sesion_permitida() RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT true
$$;
COMMENT ON FUNCTION fn_sesion_permitida() IS 'Tienda única: sin control de suspensión por mora. Siempre permite acceso.';

CREATE OR REPLACE FUNCTION fn_negocio_modulo(p_codigo text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT true
$$;
COMMENT ON FUNCTION fn_negocio_modulo(text) IS 'Tienda única: todos los módulos activos por defecto (fiscal, repuestos, etc.).';

-- Guardia creada en 41/43 usada por sp_registrar_tasa, sp_cambiar_alicuota,
-- sp_cancelar_alicuota, fn_islr_guardar_ut, sp_alta_moneda y sp_moneda_activa:
CREATE OR REPLACE FUNCTION tienda.fn_puede_editar_global() RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT true
$$;
COMMENT ON FUNCTION tienda.fn_puede_editar_global() IS 'Tienda única: la tienda administra directamente sus tasas, alícuotas, UT y monedas.';

-- -------------------------------------------------------------------
--  2. GARANTIZAR DEFAULT 1 EN TODAS LAS COLUMNAS negocio_id
-- -------------------------------------------------------------------
-- CRÍTICO: varios controladores Laravel (Categorías, Marcas, Modelos,
-- Métodos de pago, Productos, Cierres de caja) y triggers internos
-- (historial_precios / historial_costos) insertan filas sin especificar
-- negocio_id. Con DEFAULT 1 + fn_sello_negocio() nunca fallan por NOT NULL.
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.columns
              WHERE table_schema = 'tienda' AND column_name = 'negocio_id'
              ORDER BY table_name LOOP
        EXECUTE format('ALTER TABLE tienda.%I ALTER COLUMN negocio_id SET DEFAULT 1', t);
    END LOOP;
    RAISE NOTICE 'DEFAULT 1 configurado en todas las columnas negocio_id';
END $$;

-- -------------------------------------------------------------------
--  3. DESACTIVAR ROW-LEVEL SECURITY (INCLUYENDO tienda.negocio)
-- -------------------------------------------------------------------
-- Nota: tienda.negocio tiene su clave primaria en "id" (no tiene columna
-- negocio_id), pero 31_multitenant.sql también le activó ENABLE/FORCE RLS.
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables
              WHERE schemaname = 'tienda'
              ORDER BY tablename LOOP
        EXECUTE format('ALTER TABLE tienda.%I DISABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE tienda.%I NO FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS p_tenant ON tienda.%I', t);
    END LOOP;
    RAISE NOTICE 'RLS y políticas p_tenant desactivados en todo el esquema tienda';
END $$;

-- -------------------------------------------------------------------
--  4. ELIMINAR TABLAS DE CONTROL MULTI-TENANT / PLATAFORMA
-- -------------------------------------------------------------------
DROP TABLE IF EXISTS tienda.estado_tenants CASCADE;
DROP TABLE IF EXISTS tienda.plataforma_admin CASCADE;
DROP TABLE IF EXISTS tienda.plataforma_roles CASCADE;

-- -------------------------------------------------------------------
--  5. ELIMINAR ROL saas_app (LIMPIANDO PRIVILEGIOS PRIMERO)
-- -------------------------------------------------------------------
-- PostgreSQL no permite DROP ROLE si el rol tiene GRANTs o DEFAULT PRIVILEGES
-- en el esquema; primero se reasignan/eliminan sus objetos y permisos.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saas_app') THEN
        EXECUTE 'REASSIGN OWNED BY saas_app TO CURRENT_USER';
        EXECUTE 'DROP OWNED BY saas_app';
        EXECUTE 'DROP ROLE saas_app';
        RAISE NOTICE 'Rol saas_app y sus privilegios eliminados';
    END IF;
END $$;

-- -------------------------------------------------------------------
--  6. ELIMINAR FUNCIONES DE PROVISIÓN Y EXPORT/IMPORT MULTI-TENANT
-- -------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_provisionar_negocio(text, text, text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS fn_exportar_negocio(integer);
DROP FUNCTION IF EXISTS fn_importar_negocio(jsonb);
DROP FUNCTION IF EXISTS fn_subdominio_unico(text, integer);

-- -------------------------------------------------------------------
--  7. AGREGAR COLUMNA vertical A NEGOCIO
-- -------------------------------------------------------------------
ALTER TABLE negocio ADD COLUMN IF NOT EXISTS vertical VARCHAR(20) DEFAULT 'REPUESTOS';
COMMENT ON COLUMN negocio.vertical IS 'Vertical de negocio: REPUESTOS, FERRETERIA, ROPA, BODEGA. Define qué módulos específicos usar.';

-- -------------------------------------------------------------------
--  8. VERIFICACIÓN Y RESUMEN
-- -------------------------------------------------------------------
DO $$
DECLARE
    tablas_con_rls INTEGER;
BEGIN
    SELECT COUNT(*) INTO tablas_con_rls
      FROM pg_tables
     WHERE schemaname = 'tienda' AND rowsecurity IS TRUE;

    IF tablas_con_rls > 0 THEN
        RAISE EXCEPTION 'Error: aún quedan % tablas con RLS activo', tablas_con_rls;
    END IF;

    IF EXISTS (SELECT 1 FROM motos_modelos LIMIT 1) THEN
        UPDATE negocio SET vertical = 'REPUESTOS' WHERE id = 1;
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Conversión a tienda única completada';
    RAISE NOTICE '========================================';
    RAISE NOTICE '- fn_negocio_actual() devuelve 1';
    RAISE NOTICE '- fn_sesion_permitida() y fn_puede_editar_global() devuelven true';
    RAISE NOTICE '- DEFAULT 1 activo en todas las columnas negocio_id';
    RAISE NOTICE '- RLS desactivado en todas las tablas (incluida negocio)';
    RAISE NOTICE '- estado_tenants, plataforma_admin, plataforma_roles y saas_app eliminados';
END $$;

COMMENT ON SCHEMA tienda IS 'Esquema de tienda única. Todas las tablas operan con negocio_id = 1 (DEFAULT 1). Sin RLS ni portal.';
