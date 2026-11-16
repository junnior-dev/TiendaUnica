-- =============================================================
--  31_tienda_unica.sql
--  Configuración de TIENDA ÚNICA (Repuestos de Motos)
-- =============================================================
--  Idempotente: funciona tanto sobre una instalación limpia (desde 01_tablas.sql)
--  como sobre una base de datos que venía del modo multi-tenant.
--
--  Uso:
--     psql -U postgres -d tiendaunica -v ON_ERROR_STOP=1 -f database/sql/31_tienda_unica.sql
--
--  Qué hace:
--   1. fn_negocio_actual()        -> siempre devuelve 1
--   2. fn_sesion_permitida()      -> siempre devuelve true
--   3. fn_negocio_modulo(text)    -> siempre devuelve true
--   4. tienda.fn_puede_editar_global() -> siempre devuelve true
--   5. fn_sello_negocio()         -> asigna negocio_id = 1 cuando llega NULL
--   6. Garantiza negocio_id NOT NULL DEFAULT 1 + FK + índice + trg_sello_negocio
--      en las 63 tablas de negocio (soporta instalación desde cero) y DEFAULT 1
--      en cualquier otra tabla con negocio_id.
--   7. Desactiva RLS y elimina políticas p_tenant en todo el esquema tienda.
--   8. Elimina estado_tenants, plataforma_admin, plataforma_roles, rol saas_app
--      y funciones de provisión / export / import SaaS.
-- =============================================================

SET search_path = tienda, public;

-- -------------------------------------------------------------------
--  1. FUNCIONES DE SESIÓN, SELLO Y GUARDIA SIMPLIFICADAS
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

-- Guardia usada por sp_registrar_tasa, sp_cambiar_alicuota, sp_cancelar_alicuota,
-- fn_islr_guardar_ut, sp_alta_moneda y sp_moneda_activa:
CREATE OR REPLACE FUNCTION tienda.fn_puede_editar_global() RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT true
$$;
COMMENT ON FUNCTION tienda.fn_puede_editar_global() IS 'Tienda única: la tienda administra directamente sus tasas, alícuotas, UT y monedas.';

CREATE OR REPLACE FUNCTION fn_sello_negocio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.negocio_id IS NULL THEN
        NEW.negocio_id := 1;
    END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION fn_sello_negocio() IS 'Tienda única: sella negocio_id = 1 cuando un INSERT llega sin especificarlo.';

-- -------------------------------------------------------------------
--  2. GARANTIZAR negocio_id NOT NULL DEFAULT 1 EN TODAS LAS TABLAS DE NEGOCIO
-- -------------------------------------------------------------------
-- Soporta tanto BD nueva (donde 01_tablas..30 no tienen negocio_id) como BD
-- migrada desde multi-tenant.
DO $$
DECLARE
    t text;
    tablas text[] := ARRAY[
        'alertas_precio','aperturas_caja','asiento_detalle','asientos','caja_config',
        'calendario_fiscal','calendario_presentada','categorias',
        'cierres_caja','clientes','combo_componentes','combos','compra_detalle','compras',
        'compras_importacion','conciliacion_banco_lineas','conciliacion_cruces',
        'conciliaciones_bancarias','contab_config','contab_metodo_cuenta','contab_parametros',
        'conteo_detalle','conteos_fisicos','cuentas_por_cobrar','declaraciones_seniat',
        'declaraciones_seniat_montos','detalle_venta','encargos','encargos_pagos','enteros_islr',
        'historial_costos','historial_precios','islr_config','marcas','metodos_pago',
        'motos_modelos','movimientos_caja','movimientos_inventario','negocio_regimen_historial',
        'notas_ajuste','notas_ajuste_detalle','notas_cxc_aplicacion','numeracion_fiscal',
        'orden_compra_detalle','ordenes_compra','pagos_cobrar','pagos_proveedor',
        'pagos_proveedor_aplicacion','pagos_venta','periodos_contables',
        'periodos_contables_log','plan_cuentas','producto_compatibilidad','productos',
        'proveedores','retenciones_enteradas','retenciones_islr','retenciones_iva',
        'reversiones_igtf','solicitudes_idempotentes','unidades_medida','usuarios','ventas','ventas_tasas'
    ];
    prev_role text;
BEGIN
    prev_role := current_setting('session_replication_role');
    SET LOCAL session_replication_role = replica;

    FOREACH t IN ARRAY tablas LOOP
        IF to_regclass(format('tienda.%I', t)) IS NULL THEN
            CONTINUE;
        END IF;

        EXECUTE format('ALTER TABLE tienda.%I ADD COLUMN IF NOT EXISTS negocio_id integer', t);
        EXECUTE format('UPDATE tienda.%I SET negocio_id = 1 WHERE negocio_id IS NULL', t);
        EXECUTE format('ALTER TABLE tienda.%I ALTER COLUMN negocio_id SET DEFAULT 1', t);
        EXECUTE format('ALTER TABLE tienda.%I ALTER COLUMN negocio_id SET NOT NULL', t);

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conrelid = format('tienda.%I', t)::regclass
               AND conname = format('fk_%s_negocio', t)
        ) THEN
            EXECUTE format(
                'ALTER TABLE tienda.%I ADD CONSTRAINT fk_%s_negocio FOREIGN KEY (negocio_id) REFERENCES tienda.negocio(id)',
                t, t
            );
        END IF;

        EXECUTE format('CREATE INDEX IF NOT EXISTS ix_%s_negocio ON tienda.%I (negocio_id)', t, t);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_sello_negocio ON tienda.%I', t);
        EXECUTE format(
            'CREATE TRIGGER trg_sello_negocio BEFORE INSERT ON tienda.%I FOR EACH ROW EXECUTE FUNCTION fn_sello_negocio()',
            t
        );
    END LOOP;

    EXECUTE format('SET LOCAL session_replication_role = %L', prev_role);

    -- Asegurar DEFAULT 1 en cualquier otra tabla del esquema tienda con negocio_id (ej. 36, 38)
    FOR t IN SELECT table_name FROM information_schema.columns
              WHERE table_schema = 'tienda' AND column_name = 'negocio_id'
              ORDER BY table_name LOOP
        EXECUTE format('ALTER TABLE tienda.%I ALTER COLUMN negocio_id SET DEFAULT 1', t);
    END LOOP;

    RAISE NOTICE 'Columna negocio_id (DEFAULT 1) y trg_sello_negocio configurados en todas las tablas';
END $$;

-- -------------------------------------------------------------------
--  3. DESACTIVAR ROW-LEVEL SECURITY (INCLUYENDO tienda.negocio)
-- -------------------------------------------------------------------
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
--  5. ELIMINAR ROL saas_app (SI NO TIENE DEPENDENCIAS EN OTRAS BDs)
-- -------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saas_app') THEN
        EXECUTE 'REASSIGN OWNED BY saas_app TO CURRENT_USER';
        EXECUTE 'DROP OWNED BY saas_app';
        BEGIN
            EXECUTE 'DROP ROLE saas_app';
            RAISE NOTICE 'Rol saas_app y sus privilegios eliminados';
        EXCEPTION WHEN dependent_objects_still_exist THEN
            RAISE NOTICE 'Rol saas_app conservado porque tiene objetos/permisos en otra base de datos del servidor';
        END;
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
--  7. VERIFICACIÓN Y RESUMEN
-- -------------------------------------------------------------------
DO $$
DECLARE
    tablas_con_rls INTEGER;
    sin_default    INTEGER;
BEGIN
    SELECT COUNT(*) INTO tablas_con_rls
      FROM pg_tables
     WHERE schemaname = 'tienda' AND rowsecurity IS TRUE;

    IF tablas_con_rls > 0 THEN
        RAISE EXCEPTION 'Error: aún quedan % tablas con RLS activo', tablas_con_rls;
    END IF;

    SELECT COUNT(*) INTO sin_default
      FROM information_schema.columns
     WHERE table_schema = 'tienda' AND column_name = 'negocio_id'
       AND (column_default IS NULL OR column_default NOT LIKE '1%');

    IF sin_default > 0 THEN
        RAISE EXCEPTION 'Error: aún quedan % columnas negocio_id sin DEFAULT 1', sin_default;
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Configuración de tienda única (Repuestos de Motos) completada';
    RAISE NOTICE '========================================';
    RAISE NOTICE '- fn_negocio_actual() devuelve 1';
    RAISE NOTICE '- fn_sesion_permitida(), fn_negocio_modulo() y fn_puede_editar_global() devuelven true';
    RAISE NOTICE '- negocio_id NOT NULL DEFAULT 1 + trg_sello_negocio activos';
    RAISE NOTICE '- RLS desactivado en todas las tablas (incluida negocio)';
    RAISE NOTICE '- estado_tenants, plataforma_admin, plataforma_roles y saas_app eliminados';
END $$;

COMMENT ON SCHEMA tienda IS 'Esquema de tienda única (Repuestos de Motos). Todas las tablas operan con negocio_id = 1 (DEFAULT 1). Sin RLS ni portal.';
