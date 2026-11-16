-- =============================================================================
--  Archivo 31 · MULTITENANT — una base de datos, un negocio_id por fila
-- -----------------------------------------------------------------------------
--  Estrategia (decisión 2026-11-13):
--   · Una sola base y un solo esquema; cada fila de negocio lleva negocio_id.
--   · La sesión declara su negocio con  SET app.negocio_id = '<id>';
--     sin declararlo, fn_negocio_actual() devuelve 1 (compatibilidad con la
--     versión de tienda única y las 437 pruebas, que corren como superusuario).
--     Para roles de app (saas_app) la guarda fn_sesion_permitida() EXIGE el GUC:
--     sin él la sesión no ve ni escribe nada — no cae por defecto al negocio 1.
--   · Row-Level Security (RLS) + FORCE + guarda de sesión: NINGUNA consulta,
--     función o vista puede cruzar al otro negocio aunque el SQL se olvide de
--     filtrar; un tenant suspendido por mora no ve ni escribe nada.
--   · Triggers de sello: INSERT sin negocio_id explícito lo recibe de la sesión.
--   · Las unicidades de negocio (RIF de cliente, código de barras, números
--     fiscales) pasan a ser únicas POR NEGOCIO.
--   · estado_tenants: control del portal por tenant (subdominio, mora, plan,
--     módulos verticales). Portabilidad completa: fn_exportar_negocio /
--     fn_importar_negocio con remapeo de ids.
--  Idempotente: seguro de re-aplicar sobre una base ya instalada.
--  Orden de instalación fresca: 00 (01→05) + 06…30 + ESTE archivo.
-- =============================================================================

SET search_path = tienda, public;

-- ── A · Funciones de sesión y sello ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_negocio_actual() RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT COALESCE(NULLIF(current_setting('app.negocio_id', true), '')::integer, 1)
$$;
COMMENT ON FUNCTION fn_negocio_actual() IS 'Id del negocio activo según la sesión (app.negocio_id); 1 si no se fijó. Base del aislamiento multi-tenant.';

CREATE OR REPLACE FUNCTION fn_sello_negocio() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.negocio_id IS NULL THEN
        NEW.negocio_id := fn_negocio_actual();
    END IF;
    RETURN NEW;
END $$;
COMMENT ON FUNCTION fn_sello_negocio() IS 'Sella negocio_id con el negocio de la sesión cuando el INSERT llega sin él (defensa en profundidad).';

-- ── A2 · Control de plataforma: estado_tenants ───────────────────────────────
--  El portal vive FUERA de la BD de tenants (33_portal.sql); aquí queda el
--  estado operativo de cada tenant dentro de esta BD: el subdominio que resuelve
--  el middleware Laravel, la suspensión por mora que RLS hace cumplir, el plan
--  y los módulos (verticales ropa/bodega/ferretería). Global y SIN RLS: la lee
--  fn_sesion_permitida y el middleware; solo el portal (superusuario) la escribe.
CREATE TABLE IF NOT EXISTS tienda.estado_tenants (
    negocio_id    integer PRIMARY KEY REFERENCES negocio(id),
    subdominio    text NOT NULL UNIQUE,
    activo        boolean NOT NULL DEFAULT true,
    plan          text NOT NULL DEFAULT 'BASE',
    modulos       jsonb NOT NULL DEFAULT '{}'::jsonb,
    suspendida_en timestamptz,
    motivo        text
);
COMMENT ON TABLE tienda.estado_tenants IS 'Estado operativo del tenant en ESTA base: subdominio del middleware, suspensión por mora (RLS la hace cumplir vía fn_sesion_permitida), plan y módulos verticales. Escrita solo por el portal.';
COMMENT ON COLUMN tienda.estado_tenants.subdominio IS 'Subdominio DNS que identifica la tienda (la-cava → negocio X). Único en la plataforma.';
COMMENT ON COLUMN tienda.estado_tenants.modulos IS 'Verticales activos (jsonb): {"repuestos": true, "ropa": false}. Lo lee fn_negocio_modulo() y App\Support\Tenant::modulo().';

CREATE OR REPLACE FUNCTION fn_subdominio_unico(p_slug text, p_negocio integer) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
    p_slug := lower(regexp_replace(COALESCE(p_slug, ''), '[^a-zA-Z0-9]+', '-', 'g'));
    p_slug := regexp_replace(p_slug, '^-+|-+$', '', 'g');
    IF p_slug = '' THEN p_slug := 'negocio'; END IF;
    -- Subdominios reservados de la plataforma (auditoría M-5): se tratan como
    -- ocupados para que siempre caigan al slug-id (tienda-7) y ningún cliente
    -- puede apropiarse de www, portal, api, admin…
    IF p_slug IN ('www', 'portal', 'api', 'admin', 'app', 'mail', 'webmail', 'ftp',
                  'soporte', 'support', 'saas', 'demo', 'staging', 'ns1', 'ns2', 'status') THEN
        p_slug := p_slug || '-tienda';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tienda.estado_tenants
                    WHERE subdominio = p_slug AND negocio_id <> p_negocio) THEN
        RETURN p_slug;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tienda.estado_tenants
                    WHERE subdominio = p_slug || '-' || p_negocio
                      AND negocio_id <> p_negocio) THEN
        RETURN p_slug || '-' || p_negocio;
    END IF;
    RAISE EXCEPTION 'No hay subdominio disponible para «%»', p_slug USING ERRCODE = 'TV006';
END $$;
COMMENT ON FUNCTION fn_subdominio_unico(text, integer) IS 'Devuelve un subdominio libre para el negocio (slug del nombre, o slug-id si está tomado).';

-- Guarda de sesión que evalúan las políticas RLS (initplan, una vez por consulta):
--   1. exige app.negocio_id fijado — un rol de app SIN GUC ya NO cae por defecto
--      en el negocio 1 (fuga latente cerrada: ve cero filas y no puede escribir);
--   2. exige que el tenant no esté suspendido por mora.
-- El superusuario no evalúa políticas (portal, instalación, pruebas) — intacto.
CREATE OR REPLACE FUNCTION fn_sesion_permitida() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT NULLIF(current_setting('app.negocio_id', true), '') IS NOT NULL
       AND COALESCE((SELECT activo FROM tienda.estado_tenants
                      WHERE negocio_id = fn_negocio_actual()), true)
$$;
COMMENT ON FUNCTION fn_sesion_permitida() IS 'Guarda RLS: GUC app.negocio_id fijado AND tenant no suspendido. Sin GUC, la sesión de app no ve ni escribe nada (no cae al negocio 1).';

-- Subdominio semilla para cada negocio ya existente (slug de su nombre).
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT id, COALESCE(nombre_comercial, razon_social) AS nombre FROM tienda.negocio LOOP
        -- El negocio que ya existía antes del SaaS (la tienda única) conserva la parte fiscal que ya tenía (sin verticales: es generalista).
        INSERT INTO tienda.estado_tenants (negocio_id, subdominio, modulos)
        VALUES (r.id, tienda.fn_subdominio_unico(r.nombre, r.id), '{"fiscal": true}'::jsonb)
        ON CONFLICT (negocio_id) DO NOTHING;
    END LOOP;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saas_app') THEN
        CREATE ROLE saas_app NOLOGIN;
    END IF;
END $$;
GRANT SELECT ON tienda.estado_tenants TO saas_app;

-- Verticales legibles desde la sesión del tenant (el SQL de la app no los filtra).
CREATE OR REPLACE FUNCTION fn_negocio_modulo(p_codigo text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT (modulos ->> p_codigo)::boolean
                       FROM tienda.estado_tenants WHERE negocio_id = fn_negocio_actual()), false)
$$;
COMMENT ON FUNCTION fn_negocio_modulo(text) IS '¿Tiene la sesión activa el módulo vertical indicado (repuestos, ropa, bodega…)? Fuente: estado_tenants.modulos (portal).';

-- ── B · negocio_id en las 63 tablas de negocio ───────────────────────────────
--  Quedan FUERA (globales): negocio (registro de tenants), monedas, tasas_cambio,
--  log_tasas_cambio, islr_conceptos, islr_ut, parametros_fiscales (las alícuotas
--  las fija el Ejecutivo Nacional, no el negocio), calendario_obligaciones y
--  solicitudes_idempotentes (deduplicación técnica).
CREATE TEMP TABLE _mt_tablas (tabla text PRIMARY KEY);
INSERT INTO _mt_tablas(tabla) VALUES
    ('alertas_precio'),('aperturas_caja'),('asiento_detalle'),('asientos'),('caja_config'),
    ('calendario_fiscal'),('calendario_presentada'),('categorias'),
    ('cierres_caja'),('clientes'),('combo_componentes'),('combos'),('compra_detalle'),('compras'),
    ('compras_importacion'),('conciliacion_banco_lineas'),('conciliacion_cruces'),
    ('conciliaciones_bancarias'),('contab_config'),('contab_metodo_cuenta'),('contab_parametros'),
    ('conteo_detalle'),('conteos_fisicos'),('cuentas_por_cobrar'),('declaraciones_seniat'),
    ('declaraciones_seniat_montos'),('detalle_venta'),('encargos'),('encargos_pagos'),('enteros_islr'),
    ('historial_costos'),('historial_precios'),('islr_config'),('marcas'),('metodos_pago'),
    ('motos_modelos'),('movimientos_caja'),('movimientos_inventario'),('negocio_regimen_historial'),
    ('notas_ajuste'),('notas_ajuste_detalle'),('notas_cxc_aplicacion'),('numeracion_fiscal'),
    ('orden_compra_detalle'),('ordenes_compra'),('pagos_cobrar'),('pagos_proveedor'),
    ('pagos_proveedor_aplicacion'),('pagos_venta'),('periodos_contables'),
    ('periodos_contables_log'),('plan_cuentas'),('producto_compatibilidad'),('productos'),
    ('proveedores'),('retenciones_enteradas'),('retenciones_islr'),('retenciones_iva'),
    ('reversiones_igtf'),('unidades_medida'),('usuarios'),('ventas'),('ventas_tasas');

-- negocio deja de ser fila única: es el REGISTRO DE TENANTS (id no es serial).
DO $$ BEGIN
    ALTER TABLE tienda.negocio DROP CONSTRAINT IF EXISTS negocio_fila_unica;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM pg_constraint
     WHERE conrelid = 'tienda.negocio'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%id%1%';
    IF n > 0 THEN
        EXECUTE (SELECT 'ALTER TABLE tienda.negocio DROP CONSTRAINT ' || conname
                   FROM pg_constraint
                  WHERE conrelid = 'tienda.negocio'::regclass AND contype = 'c'
                    AND pg_get_constraintdef(oid) ILIKE '%id%1%' LIMIT 1);
    END IF;
END $$;

DO $$
DECLARE t text;
BEGIN
    -- El backfill es carga histórica: sin triggers (el registro de régimen es
    -- inmutable por trigger y hay que llenarle negocio_id igual que al resto).
    SET LOCAL session_replication_role = replica;
    FOR t IN SELECT tabla FROM _mt_tablas LOOP
        EXECUTE format('ALTER TABLE tienda.%I ADD COLUMN IF NOT EXISTS negocio_id integer', t);
        -- Las 4 config de PK fija llevan id = negocio; para el resto, backfill = 1.
        EXECUTE format('UPDATE tienda.%I SET negocio_id = 1 WHERE negocio_id IS NULL', t);
        EXECUTE format('ALTER TABLE tienda.%I ALTER COLUMN negocio_id SET NOT NULL', t);
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('tienda.%I', t)::regclass
                        AND contype = 'f' AND confrelid = 'tienda.negocio'::regclass
                        AND conname = 'fk_' || t || '_negocio') THEN
            EXECUTE format('ALTER TABLE tienda.%I ADD CONSTRAINT fk_%s_negocio '
                           'FOREIGN KEY (negocio_id) REFERENCES tienda.negocio(id)', t, t);
        END IF;
    END LOOP;
END $$;

-- Índice de aislamiento por negocio en cada tabla (arranque de los planes de RLS).
DO $$
DECLARE t text;
BEGIN
    FOR t IN SELECT tabla FROM _mt_tablas LOOP
        EXECUTE format('CREATE INDEX IF NOT EXISTS ix_%s_negocio ON tienda.%I (negocio_id)', t, t);
    END LOOP;
END $$;

-- ── B2 · PKs compuestas de catálogos: incluyen negocio_id ────────────────────
--  Sin esto, dos negocios chocarían por la misma clave de catálogo (UND, clave
--  de parámetro, método→cuenta, obligación del calendario). Las PKs «hijo de
--  padre» (combo_id, conteo_id, venta_id…) quedan: el padre ya separa.
DO $$
DECLARE t text;
BEGIN
    ALTER TABLE tienda.unidades_medida       DROP CONSTRAINT IF EXISTS unidades_medida_pkey;
    ALTER TABLE tienda.contab_parametros     DROP CONSTRAINT IF EXISTS contab_parametros_pkey;
    ALTER TABLE tienda.contab_metodo_cuenta  DROP CONSTRAINT IF EXISTS contab_metodo_cuenta_pkey;
    ALTER TABLE tienda.calendario_fiscal     DROP CONSTRAINT IF EXISTS calendario_fiscal_pkey;
    ALTER TABLE tienda.calendario_presentada DROP CONSTRAINT IF EXISTS calendario_presentada_pkey;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tienda.unidades_medida'::regclass AND contype = 'p') THEN
        ALTER TABLE tienda.unidades_medida ADD PRIMARY KEY (negocio_id, codigo);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tienda.contab_parametros'::regclass AND contype = 'p') THEN
        ALTER TABLE tienda.contab_parametros ADD PRIMARY KEY (negocio_id, clave);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tienda.contab_metodo_cuenta'::regclass AND contype = 'p') THEN
        ALTER TABLE tienda.contab_metodo_cuenta ADD PRIMARY KEY (negocio_id, metodo_pago_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tienda.calendario_fiscal'::regclass AND contype = 'p') THEN
        ALTER TABLE tienda.calendario_fiscal ADD PRIMARY KEY (negocio_id, regimen, obligacion, digito, periodo_desde);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tienda.calendario_presentada'::regclass AND contype = 'p') THEN
        ALTER TABLE tienda.calendario_presentada ADD PRIMARY KEY (negocio_id, obligacion, periodo_desde);
    END IF;
    -- «CHECK (id = 1)» de fila única en las 4 config de PK fija: fuera. Ahora
    -- cada negocio lleva su fila (id = id del negocio).
    FOR t IN SELECT conname FROM pg_constraint
              WHERE conrelid IN ('tienda.numeracion_fiscal'::regclass, 'tienda.caja_config'::regclass,
                                 'tienda.contab_config'::regclass, 'tienda.islr_config'::regclass)
                AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%id%=%1%'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',
                       (SELECT conrelid::regclass FROM pg_constraint WHERE conname = t LIMIT 1), t);
    END LOOP;
END $$;

-- ── C · Unicidades POR NEGOCIO ───────────────────────────────────────────────
--  Las unicidades «de valor» (RIF de cliente, SKU, código de barras, número de
--  factura, plan de cuentas…) pasan a ser únicas DENTRO de cada negocio. Los
--  índices «hijo de padre único» (venta_id, compra_id, apertura_id, nota_id,
--  conciliacion_id…) quedan globales: el padre ya separa por negocio.
DO $$
DECLARE nombre text;
BEGIN
    -- Algunas son CONSTRAINTS respaldadas por índice; otras son índices sueltos.
    FOREACH nombre IN ARRAY ARRAY[
        'asientos_numero_asiento_key','clientes_tipo_documento_documento_key',
        'compras_importacion_numero_planilla_key','compras_proveedor_id_numero_factura_key',
        'conteos_fisicos_numero_key','motos_modelos_marca_modelo_cilindrada_key',
        'notas_ajuste_tipo_numero_key','ordenes_compra_numero_key','uq_decl_periodo',
        'ventas_numero_factura_fiscal_key','ventas_numero_key','uq_categorias_nombre',
        'uq_combos_sku','uq_marcas_nombre','uq_metodos_pago_nombre','uq_plan_cuentas_codigo',
        'uq_productos_barras','uq_productos_sku','uq_proveedores_rif','uq_ret_comprobante_propio',
        'uq_retencion_islr_numero','uq_ret_enteradas','uq_usuarios_username'] LOOP
        IF EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = nombre
                      AND conrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'tienda'::regnamespace)) THEN
            EXECUTE (SELECT 'ALTER TABLE ' || conrelid::regclass || ' DROP CONSTRAINT ' || nombre
                       FROM pg_constraint WHERE conname = nombre LIMIT 1);
        ELSE
            EXECUTE format('DROP INDEX IF EXISTS tienda.%I', nombre);
        END IF;
    END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_asientos_numero       ON tienda.asientos (negocio_id, numero_asiento);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_clientes_documento    ON tienda.clientes (negocio_id, tipo_documento, documento);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_compras_importacion   ON tienda.compras_importacion (negocio_id, numero_planilla);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_compras_factura       ON tienda.compras (negocio_id, proveedor_id, numero_factura);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_conteos_numero        ON tienda.conteos_fisicos (negocio_id, numero);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_motos_modelos         ON tienda.motos_modelos (negocio_id, marca, modelo, cilindrada);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_notas_ajuste          ON tienda.notas_ajuste (negocio_id, tipo, numero);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_ordenes_numero        ON tienda.ordenes_compra (negocio_id, numero);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_decl_periodo          ON tienda.declaraciones_seniat (negocio_id, tipo, desde, hasta);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_categorias_nombre     ON tienda.categorias (negocio_id, lower((nombre)::text));
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_combos_sku            ON tienda.combos (negocio_id, upper((sku)::text));
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_marcas_nombre         ON tienda.marcas (negocio_id, lower((nombre)::text));
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_metodos_pago          ON tienda.metodos_pago (negocio_id, lower((nombre)::text));
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_plan_cuentas          ON tienda.plan_cuentas (negocio_id, codigo);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_productos_barras      ON tienda.productos (negocio_id, codigo_barras) WHERE codigo_barras IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_productos_sku         ON tienda.productos (negocio_id, upper((sku)::text));
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_proveedores_rif       ON tienda.proveedores (negocio_id, upper((rif)::text));
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_ret_comprobante       ON tienda.retenciones_iva (negocio_id, numero_comprobante) WHERE (sentido)::text = 'COMPRA';
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_retencion_islr        ON tienda.retenciones_islr (negocio_id, numero);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_ret_enteradas         ON tienda.retenciones_enteradas (negocio_id, anio, mes, quincena) WHERE (estado)::text = 'ACTIVA';
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_usuarios_username     ON tienda.usuarios (negocio_id, lower((username)::text));
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_ventas_factura_fiscal ON tienda.ventas (negocio_id, numero_factura_fiscal);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_ventas_numero         ON tienda.ventas (negocio_id, numero);


-- ── D · Row-Level Security: el aislamiento que no depende del SQL ────────────
--  Cada política incluye la guarda fn_sesion_permitida() como initplan (una vez
--  por consulta): exige GUC fijado —el rol de app SIN GUC no cae al negocio 1,
--  ve CERO filas y no puede escribir— y que el tenant no esté suspendido.
DO $$
DECLARE t text;
BEGIN
    FOR t IN SELECT tabla FROM _mt_tablas LOOP
        EXECUTE format('ALTER TABLE tienda.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE tienda.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS p_tenant ON tienda.%I', t);
        EXECUTE format($p$
            CREATE POLICY p_tenant ON tienda.%I
            USING (negocio_id = fn_negocio_actual() AND (SELECT fn_sesion_permitida()))
            WITH CHECK (negocio_id = fn_negocio_actual() AND (SELECT fn_sesion_permitida()))
        $p$, t);
    END LOOP;
    ALTER TABLE tienda.negocio ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tienda.negocio FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS p_tenant ON tienda.negocio;
    CREATE POLICY p_tenant ON tienda.negocio
        USING (id = fn_negocio_actual() AND (SELECT fn_sesion_permitida()))
        WITH CHECK (id = fn_negocio_actual() AND (SELECT fn_sesion_permitida()));
    RAISE NOTICE 'RLS con guarda de sesión en % tablas de negocio + negocio', (SELECT count(*) FROM _mt_tablas);
END $$;

-- ── E · Vistas: security_invoker ─────────────────────────────────────────────
--  Las vistas respetan el RLS del INVOCADOR (no del dueño) — si fueran
--  security definer implícito, saltarían el aislamiento.
DO $$
DECLARE v text;
BEGIN
    FOR v IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'tienda' AND c.relkind = 'v'
               AND c.relname NOT LIKE '\_%' ESCAPE '\' LOOP
        EXECUTE format('ALTER VIEW tienda.%I SET (security_invoker = true)', v);
    END LOOP;
    RAISE NOTICE 'security_invoker activado en todas las vistas de tienda';
END $$;

-- ── F · Rol de aplicación saas_app (NO superusuario) ─────────────────────────
--  Producción conecta como saas_app: el RLS SOLO protege a roles no superusuario.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saas_app') THEN
        CREATE ROLE saas_app NOLOGIN;
    END IF;
END $$;
GRANT USAGE ON SCHEMA tienda TO saas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tienda TO saas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA tienda GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO saas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tienda TO saas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA tienda GRANT USAGE, SELECT ON SEQUENCES TO saas_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tienda TO saas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA tienda GRANT EXECUTE ON FUNCTIONS TO saas_app;
GRANT saas_app TO postgres;   -- SET ROLE saas_app desde la instalación/pruebas
COMMENT ON ROLE saas_app IS 'Rol de conexión de la app en producción: NO superusuario, sujeto a RLS. Para darlo de alta como rol de conexión: ALTER ROLE saas_app LOGIN PASSWORD ''<secreto>'';';

-- ── G · Triggers de sello ────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
    FOR t IN SELECT tabla FROM _mt_tablas LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_sello_negocio ON tienda.%I', t);
        EXECUTE format('CREATE TRIGGER trg_sello_negocio BEFORE INSERT ON tienda.%I '
                       'FOR EACH ROW EXECUTE FUNCTION fn_sello_negocio()', t);
    END LOOP;
    RAISE NOTICE 'Sellos de negocio en % tablas', (SELECT count(*) FROM _mt_tablas);
END $$;

-- ── H · Siguiente paso (fuera de PostgreSQL) ─────────────────────────────────
--  Laravel (implementado en app/Http/Middleware/IdentificarTenant.php y
--  app/Support/Tenant.php):
--   1. Conectar producción con el rol saas_app (nunca postgres). Para darlo de
--      alta como rol de conexión: ALTER ROLE saas_app LOGIN PASSWORD '<secreto>';
--   2. Middleware IdentificarTenant: resuelve el subdominio en estado_tenants y
--      ejecuta SELECT set_config('app.negocio_id', '<id>', false) por petición.
--   3. El resto del código NO cambia: funciones, vistas y triggers ya quedan
--      aislados y guardados por RLS (fn_sesion_permitida).

-- ── I · Portabilidad: exportar los datos de un negocio ──────────────────────
--  fn_exportar_negocio([p_negocio_id]) devuelve un JSONB con TODAS las filas del
--  negocio (una clave por tabla, más la fila del negocio, formato v1).
--  La app (saas_app) solo exporta SU negocio (excepción TV006 si pide otro);
--  el portal (superusuario) exporta cualquiera. estado_tenants NO sale en el
--  paquete (control del portal, no del tenant).
CREATE OR REPLACE FUNCTION fn_exportar_negocio(p_negocio_id integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
    n integer;
    res jsonb;
    paquete jsonb := '{}'::jsonb;
    t text;
    es_super boolean := (SELECT rolsuper FROM pg_roles WHERE rolname = current_user);
    n_tablas int := 0;
BEGIN
    n := COALESCE(p_negocio_id, fn_negocio_actual());
    IF NOT (n = fn_negocio_actual()) AND NOT COALESCE(es_super, false) THEN
        RAISE EXCEPTION 'Solo puedes exportar TU negocio' USING ERRCODE = 'TV006';
    END IF;
    SELECT to_jsonb(x) INTO res FROM negocio x WHERE id = n;
    IF res IS NULL THEN
        RAISE EXCEPTION 'El negocio % no existe', n USING ERRCODE = 'TV006';
    END IF;
    paquete := paquete || jsonb_build_object('formato', 'v1', 'exportado_en', now(),
                                             'negocio', res);
    FOR t IN SELECT table_name FROM information_schema.columns
              WHERE table_schema = 'tienda' AND column_name = 'negocio_id'
                AND table_name <> 'estado_tenants'  -- control del portal: no sale en paquetes de un solo tenant
              ORDER BY table_name LOOP
        EXECUTE format('SELECT jsonb_agg(to_jsonb(x)) '
                       'FROM tienda.%I x WHERE negocio_id = $1', t)
           INTO res USING n;
        paquete := paquete || jsonb_build_object(t, COALESCE(res, '[]'::jsonb));
        n_tablas := n_tablas + 1;
    END LOOP;
    paquete := jsonb_set(paquete, '{tablas_exportadas}', to_jsonb(n_tablas));
    RETURN paquete;
END $$;
COMMENT ON FUNCTION fn_exportar_negocio(integer) IS 'Exporta TODO el negocio como JSONB (formato v1): la app solo puede exportar el suyo; el portal, cualquiera.';

-- ── J · Portabilidad: restaurar un negocio desde su paquete ──────────────────
--  fn_importar_negocio(p_paquete jsonb) — operación del PORTAL (superusuario):
--  crea el negocio y todas sus filas a partir de un paquete de
--  fn_exportar_negocio (formato v1), con los ids REMAPEADOS a la base destino.
--   · session_replication_role = replica: carga histórica SIN disparar triggers
--     de recálculo (kardex, saldos, numeración, sellos); el negocio_id va
--     explícito en cada fila. Los FK se verifican al final, no en la carga.
--   · negocio → usuarios primero (el ciclo configurado_por se rompe con UPDATE).
--   · El resto: orden topológico por FK (padres antes que hijos, detectado en
--     pg_constraint — las autoreferencias de plan_cuentas no bloquean).
--   · Tablas con id serial: ids nuevos + mapa {viejo: nuevo} aplicado a todas
--     las FK de las tablas siguientes. Las 4 config de PK fija
--     (numeracion_fiscal/caja_config/contab_config/islr_config) reciben
--     id = id del negocio nuevo.
--   · Secuencias re-calibradas al máximo id importado (el siguiente INSERT
--     del negocio no colisiona).
CREATE OR REPLACE FUNCTION fn_importar_negocio(p_paquete jsonb) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    n_new integer;
    v_id integer;
    t text;
    r jsonb;
    filas jsonb;
    mapas jsonb := '{}'::jsonb;
    pendientes text[];
    hechos text[] := '{}';
    hechos_ronda text[];
    tiene_id boolean;
    es_serial boolean;
    v_cols text;
    fks record;
BEGIN
    IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION 'La importación es una operación del portal (superusuario)' USING ERRCODE = 'TV006';
    END IF;
    IF p_paquete->>'formato' IS DISTINCT FROM 'v1' OR p_paquete->'negocio' IS NULL THEN
        RAISE EXCEPTION 'El paquete no es una exportación válida (formato v1)' USING ERRCODE = 'TV006';
    END IF;

    SELECT array_agg(k ORDER BY k) INTO pendientes
      FROM jsonb_object_keys(p_paquete) k
     WHERE k IN (SELECT table_name FROM information_schema.columns
                  WHERE table_schema = 'tienda' AND column_name = 'negocio_id')
       AND k NOT IN ('negocio', 'usuarios', 'estado_tenants');  -- pre-pasos y control del portal
    IF pendientes IS NULL THEN
        RAISE EXCEPTION 'El paquete no contiene tablas de negocio' USING ERRCODE = 'TV006';
    END IF;

    SET LOCAL session_replication_role = replica;

    -- 1) negocio (id NO es serial en el esquema original: se asigna max+1 a mano;
    --    sin configurado_por — se remapea tras usuarios)
    SELECT COALESCE(max(id), 0) + 1 INTO n_new FROM tienda.negocio;
    EXECUTE 'INSERT INTO tienda.negocio SELECT * FROM jsonb_populate_record(NULL::tienda.negocio, $1) RETURNING id'
       INTO n_new USING (((p_paquete->'negocio') - 'id'::text - 'configurado_por'::text)
                         || jsonb_build_object('id', n_new));
    mapas := mapas || jsonb_build_object('negocio',
                jsonb_build_object(p_paquete->'negocio'->>'id', n_new));

    -- 2) usuarios (rompe el ciclo negocio ↔ usuarios; id es IDENTITY ALWAYS:
    --    la lista va sin id y la secuencia asigna)
    SELECT string_agg(column_name, ', ') INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'tienda' AND table_name = 'usuarios' AND column_name <> 'id';
    FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(p_paquete->'usuarios', '[]'::jsonb)) LOOP
        EXECUTE format('INSERT INTO tienda.usuarios (%s) SELECT %s FROM jsonb_populate_record(NULL::tienda.usuarios, $1) RETURNING id', v_cols, v_cols)
           INTO v_id USING ((r - 'id'::text - 'negocio_id'::text) || jsonb_build_object('negocio_id', n_new));
        mapas := mapas || jsonb_build_object('usuarios',
                    COALESCE(mapas->'usuarios', '{}'::jsonb) || jsonb_build_object(r->>'id', v_id));
    END LOOP;
    IF p_paquete->'negocio'->>'configurado_por' IS NOT NULL THEN
        UPDATE tienda.negocio
           SET configurado_por = COALESCE(((mapas->'usuarios') ->> (p_paquete->'negocio'->>'configurado_por'))::integer,
                                          (SELECT min(id) FROM tienda.usuarios WHERE negocio_id = n_new))
         WHERE id = n_new;
    END IF;
    DELETE FROM tienda.negocio_regimen_historial WHERE negocio_id = n_new;  -- lo sembró el trigger; viene en el paquete

    -- 3) resto de tablas: orden topológico por FK (padres antes que hijos)
    LOOP
        EXIT WHEN pendientes IS NULL OR cardinality(pendientes) = 0;
        hechos_ronda := '{}';
        FOREACH t IN ARRAY pendientes LOOP
            IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class pc ON pc.oid = c.confrelid
                        WHERE c.conrelid = format('tienda.%I', t)::regclass AND c.contype = 'f'
                          AND array_length(c.conkey, 1) = 1 AND pc.relname = ANY (pendientes)
                          AND pc.relname <> t) THEN
                CONTINUE;   -- aún depende de otra tabla pendiente (las autoreferencias no bloquean)
            END IF;
            SELECT EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema = 'tienda' AND table_name = t AND column_name = 'id')
              INTO tiene_id;
            es_serial := tiene_id AND EXISTS (
                SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = format('tienda.%I', t)::regclass AND a.attname = 'id'
                   AND (a.attidentity <> ''
                        OR EXISTS (SELECT 1 FROM pg_attrdef d
                                    WHERE d.adrelid = a.attrelid AND d.adnum = 1
                                      AND pg_get_expr(d.adbin, d.adrelid) LIKE '%nextval%')));
            -- columnas sin id (IDENTITY ALWAYS rechaza hasta el NULL explícito)
            SELECT string_agg(column_name, ', ') INTO v_cols
              FROM information_schema.columns
             WHERE table_schema = 'tienda' AND table_name = t
               AND (NOT tiene_id OR column_name <> 'id');

            filas := p_paquete->t;
            -- remapear TODAS las FK de una columna hacia tablas ya importadas
            FOR fks IN SELECT sa.attname AS col, pc.relname AS padre
                         FROM pg_constraint c
                         JOIN pg_class pc ON pc.oid = c.confrelid
                         JOIN pg_attribute sa ON sa.attrelid = c.conrelid AND sa.attnum = c.conkey[1]
                        WHERE c.conrelid = format('tienda.%I', t)::regclass AND c.contype = 'f'
                          AND array_length(c.conkey, 1) = 1 AND mapas ? pc.relname
            LOOP
                -- Con ->> (SQL NULL): un FK nulo deja la fila intacta. Si se
                -- usara -> (JSON null) o jsonb_set(..., NULL), la fila entera
                -- se perdería (jsonb_set con valor NULL devuelve NULL).
                filas := (SELECT jsonb_agg(
                            CASE WHEN x ->> fks.col IS NOT NULL
                                  AND (mapas -> fks.padre) ->> (x ->> fks.col) IS NOT NULL
                                 THEN jsonb_set(x, ARRAY[fks.col],
                                        to_jsonb(((mapas -> fks.padre) ->> (x ->> fks.col))::integer))
                                 ELSE x END)
                          FROM jsonb_array_elements(filas) x);
            END LOOP;

            FOR r IN SELECT * FROM jsonb_array_elements(filas) LOOP
                r := (r - 'negocio_id'::text) || jsonb_build_object('negocio_id', n_new);
                IF es_serial THEN
                    EXECUTE format('INSERT INTO tienda.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::tienda.%I, $1) RETURNING id',
                                   t, v_cols, v_cols, t)
                       INTO v_id USING (r - 'id'::text);
                    mapas := mapas || jsonb_build_object(t,
                                COALESCE(mapas->t, '{}'::jsonb) || jsonb_build_object(r->>'id', v_id));
                ELSIF tiene_id THEN
                    EXECUTE format('INSERT INTO tienda.%I SELECT * FROM jsonb_populate_record(NULL::tienda.%I, $1)', t, t)
                       USING ((r - 'id'::text) || jsonb_build_object('id', n_new));
                ELSE
                    EXECUTE format('INSERT INTO tienda.%I SELECT * FROM jsonb_populate_record(NULL::tienda.%I, $1)', t, t) USING r;
                END IF;
            END LOOP;
            hechos_ronda := hechos_ronda || t;
            -- autoreferencias (p.ej. plan_cuentas.parent_id): con el mapa COMPLETO
            -- de la tabla, segundo pase que re-traduce los ids viejos que quedaron
            FOR fks IN SELECT sa.attname AS col
                         FROM pg_constraint c
                         JOIN pg_attribute sa ON sa.attrelid = c.conrelid AND sa.attnum = c.conkey[1]
                        WHERE c.conrelid = format('tienda.%I', t)::regclass AND c.contype = 'f'
                          AND c.confrelid = c.conrelid AND array_length(c.conkey, 1) = 1
                          AND mapas ? t
            LOOP
                EXECUTE format('UPDATE tienda.%I SET %I = COALESCE((( $1 ->> (%I::text) ))::integer, %I) '
                               'WHERE negocio_id = %s',
                               t, fks.col, fks.col, fks.col, n_new) USING (mapas->t);
            END LOOP;
        END LOOP;
        IF cardinality(hechos_ronda) = 0 THEN
            RAISE EXCEPTION 'Dependencia circular entre tablas del paquete: %', pendientes USING ERRCODE = 'TV006';
        END IF;
        hechos := hechos || hechos_ronda;
        SELECT array_agg(x ORDER BY x) INTO pendientes FROM unnest(pendientes) x WHERE NOT (x = ANY (hechos));
    END LOOP;

    -- 4) fila de control del portal para el negocio restaurado
    SELECT COALESCE(nombre_comercial, razon_social) INTO t FROM tienda.negocio WHERE id = n_new;
    INSERT INTO tienda.estado_tenants (negocio_id, subdominio, plan, modulos)
    VALUES (n_new, tienda.fn_subdominio_unico(t, n_new), 'BASE', '{}'::jsonb)
    ON CONFLICT (negocio_id) DO NOTHING;

    -- 5) re-calibrar las secuencias de las tablas con ids nuevos (solo las que
    --    tienen secuencia; negocio.id, por ejemplo, la lleva a mano)
    FOR t IN SELECT k FROM jsonb_object_keys(mapas) k LOOP
        EXECUTE format('SELECT CASE WHEN pg_get_serial_sequence(''tienda.%I'', ''id'') IS NOT NULL
                        THEN setval(pg_get_serial_sequence(''tienda.%I'', ''id''),
                                    GREATEST((SELECT COALESCE(max(id), 1) FROM tienda.%I), 1)) END', t, t, t);
    END LOOP;
    RETURN n_new;
END $$;
COMMENT ON FUNCTION fn_importar_negocio(jsonb) IS 'Restaura un negocio desde fn_exportar_negocio (formato v1). Portal (superusuario): ids remapeados, carga sin recálculos (replica), secuencias re-calibradas. Devuelve el id del negocio creado.';
