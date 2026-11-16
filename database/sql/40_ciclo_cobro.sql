-- =============================================================================
--  Archivo 40 · CICLO DE COBRO (base del portal, esquema portal)
-- -----------------------------------------------------------------------------
--  Instalación: psql -d portal_saas -f 40_ciclo_cobro.sql   (después de 33 y 34; se puede repetir)
--
--  1. El pago NO pierde días: cada mes pagado cubre un mes completo contado desde
--     donde terminaba lo ya pagado (o la demo). Pagar antes de que venza suma;
--     pagar ya vencido empieza hoy. Antes vencía a fin de mes calendario y quien
--     pagaba el día 28 recibía 2 días por un mes entero.
--  2. El barrido diario completa el ciclo: ACTIVO/PRUEBA vencido → MORA, y MORA
--     con los días de gracia agotados → SUSPENDIDO. Cada paso deja UNA línea en la
--     bitácora (antes repetía «MORA» todos los días).
--  3. v_propagacion: lo que `php artisan portal:propagar` escribe en estado_tenants.
-- =============================================================================
SET search_path = portal, public;

-- «Vence hoy» y «días de gracia» se cuentan con la fecha de Venezuela, no la del servidor (si está en UTC, cambiaría a las 8 pm).
DO $$ BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), 'America/Caracas');
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'No se pudo fijar la zona horaria de la base (%): hazlo con ALTER DATABASE %% SET timezone = ''America/Caracas''', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION portal.fn_registrar_cobro(p_negocio_portal_id integer, p_periodo date,
        p_monto numeric DEFAULT NULL, p_metodo text DEFAULT 'transferencia',
        p_nota text DEFAULT NULL) RETURNS date
LANGUAGE plpgsql AS $$
DECLARE
    n record;
    v_monto numeric(10,2);
    v_inicio date;
    v_vence date;
BEGIN
    SELECT * INTO n FROM portal.negocios_portal WHERE id = p_negocio_portal_id FOR UPDATE;
    IF n.id IS NULL THEN
        RAISE EXCEPTION 'El registro % no existe en el portal', p_negocio_portal_id USING ERRCODE = 'P0002';
    END IF;
    v_monto := COALESCE(p_monto, (SELECT precio_usd FROM portal.planes WHERE id = n.plan_id), 0);
    -- Dónde empieza el mes que se paga: al día siguiente de lo ya cubierto, o hoy si ya venció.
    v_inicio := CASE WHEN n.vence_el IS NOT NULL AND n.vence_el >= current_date
                     THEN n.vence_el + 1 ELSE current_date END;
    v_vence := ((v_inicio + interval '1 month')::date) - 1;
    -- p_periodo se conserva por compatibilidad: el periodo real lo fija el calendario de cobertura.
    INSERT INTO portal.cobros (negocio_portal_id, periodo, monto, pagado_el, metodo, nota)
    VALUES (p_negocio_portal_id, date_trunc('month', v_inicio)::date, v_monto, current_date, p_metodo, p_nota);
    UPDATE portal.negocios_portal SET estado = 'ACTIVO', vence_el = v_vence WHERE id = p_negocio_portal_id;
    INSERT INTO portal.eventos_portal (negocio_portal_id, tipo, detalle)
    VALUES (p_negocio_portal_id, 'COBRO', v_monto || ' USD · cubre del ' || v_inicio || ' al ' || v_vence);
    RETURN v_vence;
END $$;
COMMENT ON FUNCTION portal.fn_registrar_cobro(integer, date, numeric, text, text) IS 'Registra un mes pagado sin perder días: cubre un mes completo desde el fin de lo ya pagado (o desde hoy si está vencido) y activa la tienda. Devuelve la nueva fecha de vencimiento.';

CREATE OR REPLACE FUNCTION portal.fn_suspender_morosos() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_gracia integer;
    v_n integer;
BEGIN
    IF to_regclass('portal.config') IS NOT NULL THEN
        EXECUTE 'SELECT valor::int FROM portal.config WHERE clave = ''dias_gracia''' INTO v_gracia;
    END IF;
    v_gracia := COALESCE(v_gracia, 3);
    WITH pasadas AS (
        UPDATE portal.negocios_portal
           SET estado = 'SUSPENDIDO'
         WHERE estado = 'MORA' AND vence_el + v_gracia < current_date
        RETURNING id, vence_el
    ), bitacora AS (
        INSERT INTO portal.eventos_portal (negocio_portal_id, tipo, detalle)
        SELECT id, 'SUSPENSION', 'mora: venció el ' || vence_el || ' y pasaron los ' || v_gracia || ' días de gracia'
          FROM pasadas
    )
    SELECT count(*) INTO v_n FROM pasadas;
    RETURN v_n;
END $$;
COMMENT ON FUNCTION portal.fn_suspender_morosos() IS 'MORA con los días de gracia agotados → SUSPENDIDO. Devuelve cuántas tiendas se suspendieron.';

CREATE OR REPLACE FUNCTION portal.fn_verificar_vencimientos() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_morosos integer;
BEGIN
    WITH vencidas AS (
        UPDATE portal.negocios_portal
           SET estado = 'MORA'
         WHERE estado IN ('ACTIVO', 'PRUEBA') AND vence_el < current_date
        RETURNING id, vence_el, estado
    ), bitacora AS (
        INSERT INTO portal.eventos_portal (negocio_portal_id, tipo, detalle)
        SELECT id, 'MORA', 'venció el ' || vence_el FROM vencidas
    )
    SELECT count(*) INTO v_morosos FROM vencidas;
    PERFORM portal.fn_suspender_morosos();
    RETURN v_morosos;
END $$;
COMMENT ON FUNCTION portal.fn_verificar_vencimientos() IS 'Barrido diario (portal:propagar): vencidos → MORA y, agotada la gracia, MORA → SUSPENDIDO. Devuelve cuántos entraron hoy en mora.';

CREATE OR REPLACE VIEW portal.v_propagacion AS
SELECT n.id AS negocio_portal_id, n.subdominio, n.negocio_id, n.db_host, n.db_puerto, n.db_nombre,
       p.nombre AS plan,
       COALESCE((p.modulos ->> 'fiscal')::boolean, false) AS fiscal,
       n.estado,
       n.estado NOT IN ('SUSPENDIDO', 'CANCELADO') AS activo,
       n.vence_el
FROM portal.negocios_portal n
LEFT JOIN portal.planes p ON p.id = n.plan_id;
COMMENT ON VIEW portal.v_propagacion IS 'Veredicto del portal por tienda (plan, fiscal, activo). Lo aplica portal:propagar en tienda.estado_tenants; MORA sigue activa durante la gracia.';
