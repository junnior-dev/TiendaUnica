-- =============================================================================
--  Archivo 41 · ENDURECIMIENTO DE SEGURIDAD (auditoría del 2026-11-15)
--  Ejecutar después del 39 (necesita 31_multitenant: estado_tenants y saas_app).
--  Idempotente: seguro de ejecutarlo sobre una instalación existente.
--
--  Cierra los hallazgos de la auditoría que viven en la base de datos:
--    A-1 · estado_tenants quedaba escribible por saas_app (el GRANT general del
--          31 la incluyó porque existía antes del barrido): un tenant podía
--          des-suspenderse por mora, cambiar su plan o REASIGNAR el subdominio
--          de otro negocio ante una inyección SQL.
--    A-4 · tablas globales (tasas de cambio, alícuotas fiscales, unidad
--          tributaria, monedas, conceptos ISLR, calendario SENIAT) escribibles
--          por CUALQUIER tenant: cambiaba la UT y desviaba el ISLR de todos.
--    B-5 · solicitudes_idempotentes sin negocio_id (API futura de la caja).
--
--  El diseño: esas tablas quedan de SOLO LECTURA para saas_app; las escrituras
--  legítimas pasan por los procedimientos SECURITY DEFINER de este archivo,
--  que exigen tienda.fn_puede_editar_global() (superusuario, o el tenant cuyo
--  estado_tenants.modulos traiga «editar_global»: true — por defecto, la tienda
--  de la plataforma). En producción el propagador del portal escribe
--  estado_tenants con la conexión pgsql_admin (DB_ADMIN_USERNAME).
-- =============================================================================

-- ── 1 · Guardia: ¿esta sesión puede escribir tablas globales? ────────────────
CREATE OR REPLACE FUNCTION tienda.fn_puede_editar_global() RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
        OR COALESCE((SELECT (modulos ->> 'editar_global')::boolean
                       FROM tienda.estado_tenants
                      WHERE negocio_id = tienda.fn_negocio_actual()), false)
$$;
COMMENT ON FUNCTION tienda.fn_puede_editar_global() IS
'¿Puede la sesión escribir las tablas globales (tasas_cambio, parametros_fiscales, islr_ut, monedas)? Superusuario, o tenant con estado_tenants.modulos.editar_global=true.';

-- ── 2 · estado_tenants: SOLO el portal la escribe (A-1) ──────────────────────
REVOKE INSERT, UPDATE, DELETE ON tienda.estado_tenants FROM saas_app;

-- ── 3 · Tablas globales de solo lectura para los tenants (A-4) ───────────────
REVOKE INSERT, UPDATE, DELETE ON tienda.tasas_cambio         FROM saas_app;
REVOKE INSERT, UPDATE, DELETE ON tienda.log_tasas_cambio     FROM saas_app;
REVOKE INSERT, UPDATE, DELETE ON tienda.monedas              FROM saas_app;
REVOKE INSERT, UPDATE, DELETE ON tienda.parametros_fiscales  FROM saas_app;
REVOKE INSERT, UPDATE, DELETE ON tienda.islr_ut              FROM saas_app;
REVOKE INSERT, UPDATE, DELETE ON tienda.islr_conceptos       FROM saas_app;
REVOKE INSERT, UPDATE, DELETE ON tienda.calendario_obligaciones FROM saas_app;

-- ── 4 · sp_registrar_tasa: SECURITY DEFINER + guardia ────────────────────────
--  Misma lógica que 02_funciones_procedimientos.sql (únicamente añade la guardia
--  y derechos de definer: con las tablas revocadas, es la única vía de entrada).
CREATE OR REPLACE PROCEDURE tienda.sp_registrar_tasa(
    p_tasa numeric, p_fecha_valor date, p_fuente text DEFAULT 'MANUAL', p_es_oficial_bcv boolean DEFAULT false,
    p_usuario_id bigint DEFAULT NULL, p_origen char(3) DEFAULT 'USD', p_destino char(3) DEFAULT 'VES')
LANGUAGE plpgsql SECURITY DEFINER SET search_path = tienda, public AS $$
DECLARE maxfut int;
BEGIN
    IF NOT tienda.fn_puede_editar_global() THEN
        RAISE EXCEPTION 'Las tasas de cambio las administra la plataforma (módulo editar_global)' USING ERRCODE = 'TV006';
    END IF;
    SELECT dias_max_tasa_futura INTO maxfut FROM negocio WHERE id = fn_negocio_actual();
    maxfut := COALESCE(maxfut, 5);
    IF p_tasa IS NULL OR p_tasa = 'NaN' OR p_tasa <= 0 THEN RAISE EXCEPTION 'La tasa debe ser un número mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha_valor > fn_hoy() + maxfut THEN RAISE EXCEPTION 'La fecha valor % está demasiado adelantada (máximo hoy + % días)', p_fecha_valor, maxfut USING ERRCODE = 'TV006'; END IF;
    INSERT INTO tasas_cambio (moneda_origen, moneda_destino, tasa, fecha_valor, fuente, es_oficial_bcv, usuario_id)
    VALUES (p_origen, p_destino, p_tasa, p_fecha_valor, p_fuente, p_es_oficial_bcv, p_usuario_id)
    ON CONFLICT (moneda_origen, moneda_destino, fecha_valor)
    DO UPDATE SET tasa = EXCLUDED.tasa, fuente = EXCLUDED.fuente, es_oficial_bcv = EXCLUDED.es_oficial_bcv,
                  obtenida_en = now(), usuario_id = EXCLUDED.usuario_id;
END $$;

-- ── 5 · sp_cambiar_alicuota: SECURITY DEFINER + guardia ──────────────────────
CREATE OR REPLACE PROCEDURE tienda.sp_cambiar_alicuota(p_codigo text, p_nuevo_pct numeric, p_desde date, p_nota text, p_usuario_id bigint DEFAULT NULL)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = tienda, public AS $$
DECLARE abierta parametros_fiscales;
BEGIN
    IF NOT tienda.fn_puede_editar_global() THEN
        RAISE EXCEPTION 'Las alícuotas fiscales las administra la plataforma (módulo editar_global)' USING ERRCODE = 'TV006';
    END IF;
    IF p_codigo IS NULL OR p_codigo NOT IN ('IVA_GENERAL', 'IGTF_DIVISAS') THEN
        RAISE EXCEPTION 'Código de alícuota inválido: % (use IVA_GENERAL o IGTF_DIVISAS)', p_codigo USING ERRCODE = 'TV006'; END IF;
    IF p_nuevo_pct IS NULL OR p_nuevo_pct = 'NaN' OR p_nuevo_pct < 0 OR p_nuevo_pct > 100 THEN
        RAISE EXCEPTION 'El porcentaje debe estar entre 0 y 100' USING ERRCODE = 'TV006'; END IF;
    IF p_desde IS NULL THEN RAISE EXCEPTION 'Indique desde qué fecha rige la nueva alícuota' USING ERRCODE = 'TV006'; END IF;
    IF p_desde < fn_hoy() THEN
        RAISE EXCEPTION 'La nueva alícuota no puede regir desde una fecha pasada (%): las ventas ya emitidas congelaron la anterior', p_desde USING ERRCODE = 'TV006'; END IF;
    IF p_nota IS NULL OR length(trim(p_nota)) < 3 THEN
        RAISE EXCEPTION 'Indique la nota (decreto o fuente) del cambio de alícuota' USING ERRCODE = 'TV006'; END IF;

    PERFORM pg_advisory_xact_lock(hashtext('parametros_fiscales:' || p_codigo));
    SELECT * INTO abierta FROM parametros_fiscales WHERE codigo = p_codigo AND vigente_hasta IS NULL;
    IF abierta.id IS NULL THEN
        RAISE EXCEPTION 'No hay una vigencia abierta de % que cerrar; revise parametros_fiscales', p_codigo USING ERRCODE = 'TV006'; END IF;
    IF p_desde <= abierta.vigente_desde THEN
        RAISE EXCEPTION 'La nueva vigencia (%) debe ser posterior al inicio de la vigente (%)', p_desde, abierta.vigente_desde USING ERRCODE = 'TV006'; END IF;
    IF abierta.porcentaje = p_nuevo_pct THEN
        RAISE EXCEPTION 'La alícuota % ya es % %% desde %', p_codigo, p_nuevo_pct, abierta.vigente_desde USING ERRCODE = 'TV006'; END IF;

    UPDATE parametros_fiscales SET vigente_hasta = p_desde - 1 WHERE id = abierta.id;
    INSERT INTO parametros_fiscales (codigo, porcentaje, vigente_desde, nota, creado_por)
    VALUES (p_codigo, p_nuevo_pct, p_desde, trim(p_nota), p_usuario_id);
END $$;

-- ── 6 · Cancelar un cambio de alícuota programado (era SQL directo del PHP) ──
CREATE OR REPLACE PROCEDURE tienda.sp_cancelar_alicuota(p_codigo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = tienda, public AS $$
DECLARE f parametros_fiscales; hoy date := fn_hoy();
BEGIN
    IF NOT tienda.fn_puede_editar_global() THEN
        RAISE EXCEPTION 'Las alícuotas fiscales las administra la plataforma (módulo editar_global)' USING ERRCODE = 'TV006';
    END IF;
    IF p_codigo IS NULL OR p_codigo NOT IN ('IVA_GENERAL', 'IGTF_DIVISAS') THEN
        RAISE EXCEPTION 'Código de alícuota inválido: %', p_codigo USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO f FROM parametros_fiscales WHERE codigo = p_codigo AND vigente_desde > hoy;
    IF f.id IS NULL THEN
        RAISE EXCEPTION 'No hay un cambio programado para cancelar.' USING ERRCODE = 'TV005'; END IF;
    DELETE FROM parametros_fiscales WHERE id = f.id;
    -- La vigencia anterior vuelve a quedar abierta.
    UPDATE parametros_fiscales SET vigente_hasta = NULL
     WHERE codigo = p_codigo AND vigente_hasta = f.vigente_desde - 1;
END $$;

-- ── 7 · fn_islr_guardar_ut: SECURITY DEFINER + guardia ───────────────────────
CREATE OR REPLACE FUNCTION tienda.fn_islr_guardar_ut(p_desde date, p_valor numeric, p_nota text, p_usuario_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = tienda, public AS $$
BEGIN
    IF NOT tienda.fn_puede_editar_global() THEN
        RAISE EXCEPTION 'La unidad tributaria la administra la plataforma (módulo editar_global)' USING ERRCODE = 'TV006';
    END IF;
    IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'La unidad tributaria debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF p_desde IS NULL OR p_desde > fn_hoy() THEN RAISE EXCEPTION 'La fecha de vigencia no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF EXISTS (SELECT 1 FROM retenciones_islr WHERE estado = 'ACTIVA' AND fecha >= p_desde) THEN
        RAISE EXCEPTION 'Ya hay retenciones desde esa fecha: elige una vigencia posterior a la última retención' USING ERRCODE = 'TV005';
    END IF;
    INSERT INTO islr_ut (desde, valor_ves, nota, usuario_id) VALUES (p_desde, p_valor, NULLIF(trim(p_nota), ''), p_usuario_id)
    ON CONFLICT (desde) DO UPDATE SET valor_ves = EXCLUDED.valor_ves, nota = EXCLUDED.nota, usuario_id = EXCLUDED.usuario_id;
END $$;

-- ── 8 · Monedas: alta y activación como procedimientos con guardia ───────────
CREATE OR REPLACE PROCEDURE tienda.sp_alta_moneda(p_codigo text, p_nombre text, p_simbolo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = tienda, public AS $$
BEGIN
    IF NOT tienda.fn_puede_editar_global() THEN
        RAISE EXCEPTION 'El catálogo de monedas lo administra la plataforma (módulo editar_global)' USING ERRCODE = 'TV006';
    END IF;
    IF p_codigo IS NULL OR p_codigo !~ '^[A-Za-z]{3}$' THEN
        RAISE EXCEPTION 'Código de moneda inválido (3 letras)' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO monedas (codigo, nombre, simbolo, activa)
    VALUES (upper(p_codigo), COALESCE(p_nombre, upper(p_codigo)), COALESCE(p_simbolo, upper(p_codigo)), true)
    ON CONFLICT (codigo) DO UPDATE SET activa = true;
END $$;

CREATE OR REPLACE PROCEDURE tienda.sp_moneda_activa(p_codigo text, p_activa boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = tienda, public AS $$
BEGIN
    IF NOT tienda.fn_puede_editar_global() THEN
        RAISE EXCEPTION 'El catálogo de monedas lo administra la plataforma (módulo editar_global)' USING ERRCODE = 'TV006';
    END IF;
    IF p_codigo IS NULL OR upper(p_codigo) IN ('USD', 'VES') THEN
        RAISE EXCEPTION 'USD (base) y VES no se pueden desactivar' USING ERRCODE = 'TV006'; END IF;
    UPDATE monedas SET activa = COALESCE(p_activa, true) WHERE codigo = upper(p_codigo);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Esa moneda no existe' USING ERRCODE = 'TV005'; END IF;
END $$;

-- ── 9 · solicitudes_idempotentes con negocio_id (B-5: API futura de la caja) ─
ALTER TABLE tienda.solicitudes_idempotentes
    ADD COLUMN IF NOT EXISTS negocio_id smallint REFERENCES tienda.negocio(id);
COMMENT ON COLUMN tienda.solicitudes_idempotentes.negocio_id IS
'Negocio que emitió la solicitud (clave de idempotencia POR negocio). Obligatorio antes de conectar la API de caja; el sello trg_sello_negocio NO aplica: tabla global.';

-- ── 10 · La tienda de la plataforma (negocio 1) administra las globales ──────
UPDATE tienda.estado_tenants
   SET modulos = COALESCE(modulos, '{}'::jsonb) || '{"editar_global": true}'::jsonb
 WHERE negocio_id = 1;

-- ── 11 · Asegurar EXECUTE de los procedimientos endurecidos al rol de app ────
GRANT EXECUTE ON PROCEDURE tienda.sp_registrar_tasa(numeric, date, text, boolean, bigint, char(3), char(3)) TO saas_app;
GRANT EXECUTE ON PROCEDURE tienda.sp_cambiar_alicuota(text, numeric, date, text, bigint) TO saas_app;
GRANT EXECUTE ON PROCEDURE tienda.sp_cancelar_alicuota(text) TO saas_app;
GRANT EXECUTE ON PROCEDURE tienda.sp_alta_moneda(text, text, text) TO saas_app;
GRANT EXECUTE ON PROCEDURE tienda.sp_moneda_activa(text, boolean) TO saas_app;
GRANT EXECUTE ON FUNCTION tienda.fn_islr_guardar_ut(date, numeric, text, bigint) TO saas_app;
GRANT EXECUTE ON FUNCTION tienda.fn_puede_editar_global() TO saas_app;
