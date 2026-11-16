-- =============================================================================
--  Archivo 33 · PORTAL SAAS — la base central (FUERA de la BD de tenants)
-- -----------------------------------------------------------------------------
--  «portal_saas» es UNA base para toda la plataforma: alta de tiendas, planes,
--  cobros, vencimientos y el veredicto de mora. Las BD de tenants (tienda) no
--  la conocen; el propagador (comando del portal o cron) aplica el veredicto a
--  cada tenant vía tienda.estado_tenants.activo — y RLS hace cumplir el resto.
--
--  Instalación:  createdb portal_saas
--                psql -d portal_saas -f 33_portal.sql
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS portal;
SET search_path = portal, public;

-- ── Catálogo comercial ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal.planes (
    id            smallserial PRIMARY KEY,
    nombre        text NOT NULL UNIQUE,
    precio_usd    numeric(8,2) NOT NULL CHECK (precio_usd >= 0),
    max_usuarios  integer NOT NULL DEFAULT 5,
    max_productos integer NOT NULL DEFAULT 500,
    modulos       jsonb NOT NULL DEFAULT '{}'::jsonb,
    notas         text
);
COMMENT ON TABLE portal.planes IS 'Plan comercial: precio mensual, topes y verticales incluidos.';

CREATE TABLE IF NOT EXISTS portal.negocios_portal (
    id                 serial PRIMARY KEY,
    subdominio         text NOT NULL UNIQUE,
    negocio_id         integer NOT NULL,
    db_host            text NOT NULL DEFAULT 'localhost',
    db_puerto          integer NOT NULL DEFAULT 5432,
    db_nombre          text NOT NULL DEFAULT 'tienda',
    plan_id            smallint REFERENCES portal.planes(id),
    estado             text NOT NULL DEFAULT 'PRUEBA'
                       CHECK (estado IN ('PRUEBA', 'ACTIVO', 'MORA', 'SUSPENDIDO', 'CANCELADO')),
    vence_el           date,
    correo_facturacion text,
    creado_en          timestamptz NOT NULL DEFAULT now(),
    notas              text,
    UNIQUE (db_host, db_nombre, negocio_id)
);
COMMENT ON TABLE portal.negocios_portal IS 'Registro central de tenants: dónde vive (host/bd/negocio_id), su plan y su estado comercial. UNA fila por tienda en toda la plataforma.';
COMMENT ON COLUMN portal.negocios_portal.vence_el IS 'Fecha hasta la que está pagado. Pasada esa fecha el tenant entra en MORA al correr fn_verificar_vencimientos.';

CREATE TABLE IF NOT EXISTS portal.cobros (
    id                serial PRIMARY KEY,
    negocio_portal_id integer NOT NULL REFERENCES portal.negocios_portal(id) ON DELETE CASCADE,
    periodo           date NOT NULL,          -- primer día del mes que se paga
    monto             numeric(10,2) NOT NULL CHECK (monto >= 0),
    moneda            text NOT NULL DEFAULT 'USD',
    pagado_el         date,
    metodo            text,
    nota              text,
    creado_en         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (negocio_portal_id, periodo)
);
COMMENT ON TABLE portal.cobros IS 'Un cobro por periodo; el segundo intento del mismo mes lo rechaza la UNIQUE.';

CREATE TABLE IF NOT EXISTS portal.eventos_portal (
    id                serial PRIMARY KEY,
    negocio_portal_id integer REFERENCES portal.negocios_portal(id) ON DELETE CASCADE,
    tipo              text NOT NULL,
    detalle           text,
    creado_en         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE portal.eventos_portal IS 'Bitácora del ciclo de vida: alta, cobro, mora, suspensión, reactivación.';

-- ── Ciclo de vida ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION portal.fn_alta_tenant(p_subdominio text, p_negocio_id integer,
        p_plan text, p_db_nombre text DEFAULT 'tienda', p_db_host text DEFAULT 'localhost',
        p_correo text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_id integer;
    v_plan smallint;
BEGIN
    SELECT id INTO v_plan FROM portal.planes WHERE nombre = p_plan;
    IF v_plan IS NULL THEN
        RAISE EXCEPTION 'El plan «%» no existe', p_plan USING ERRCODE = 'P0002';
    END IF;
    INSERT INTO portal.negocios_portal (subdominio, negocio_id, db_host, db_nombre, plan_id,
             estado, vence_el, correo_facturacion)
    VALUES (lower(p_subdominio), p_negocio_id, p_db_host, p_db_nombre, v_plan,
            'PRUEBA', current_date + 15, p_correo)
    RETURNING id INTO v_id;
    INSERT INTO portal.eventos_portal (negocio_portal_id, tipo, detalle)
    VALUES (v_id, 'ALTA', 'prueba gratis hasta ' || (current_date + 15));
    RETURN v_id;
END $$;
COMMENT ON FUNCTION portal.fn_alta_tenant(text, integer, text, text, text, text) IS 'Da de alta una tienda: 15 días de prueba (PRUEBA). Devuelve el id del registro.';

CREATE OR REPLACE FUNCTION portal.fn_registrar_cobro(p_negocio_portal_id integer, p_periodo date,
        p_monto numeric DEFAULT NULL, p_metodo text DEFAULT 'transferencia',
        p_nota text DEFAULT NULL) RETURNS date
LANGUAGE plpgsql AS $$
DECLARE
    n record;
    v_monto numeric(10,2);
    v_vence date;
BEGIN
    SELECT * INTO n FROM portal.negocios_portal WHERE id = p_negocio_portal_id;
    IF n.id IS NULL THEN
        RAISE EXCEPTION 'El registro % no existe en el portal', p_negocio_portal_id USING ERRCODE = 'P0002';
    END IF;
    v_monto := COALESCE(p_monto, (SELECT precio_usd FROM portal.planes WHERE id = n.plan_id), 0);
    v_vence := (date_trunc('month', p_periodo) + interval '1 month - 1 day')::date;
    INSERT INTO portal.cobros (negocio_portal_id, periodo, monto, pagado_el, metodo, nota)
    VALUES (p_negocio_portal_id, date_trunc('month', p_periodo)::date, v_monto, current_date, p_metodo, p_nota);
    UPDATE portal.negocios_portal
       SET estado = 'ACTIVO', vence_el = GREATEST(COALESCE(vence_el, v_vence), v_vence)
     WHERE id = p_negocio_portal_id;
    INSERT INTO portal.eventos_portal (negocio_portal_id, tipo, detalle)
    VALUES (p_negocio_portal_id, 'COBRO', v_monto || ' USD · paga hasta ' || v_vence);
    RETURN v_vence;
END $$;
COMMENT ON FUNCTION portal.fn_registrar_cobro(integer, date, numeric, text, text) IS 'Registra el cobro de un periodo: activa el tenant y extiende vence_el hasta el fin de ese mes.';

CREATE OR REPLACE FUNCTION portal.fn_verificar_vencimientos() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    v_morosos integer;
BEGIN
    WITH vencidas AS (
        UPDATE portal.negocios_portal
           SET estado = 'MORA'
         WHERE estado IN ('ACTIVO', 'PRUEBA') AND vence_el < current_date
        RETURNING id
    )
    SELECT count(*) INTO v_morosos FROM vencidas;
    INSERT INTO portal.eventos_portal (negocio_portal_id, tipo, detalle)
    SELECT id, 'MORA', 'venció el ' || vence_el FROM portal.negocios_portal WHERE estado = 'MORA';
    RETURN v_morosos;
END $$;
COMMENT ON FUNCTION portal.fn_verificar_vencimientos() IS 'Barrido diario (cron): los vencidos pasan a MORA. Devuelve cuántos entraron hoy.';

CREATE OR REPLACE FUNCTION portal.fn_suspender(p_negocio_portal_id integer, p_motivo text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE portal.negocios_portal SET estado = 'SUSPENDIDO' WHERE id = p_negocio_portal_id;
    INSERT INTO portal.eventos_portal (negocio_portal_id, tipo, detalle)
    VALUES (p_negocio_portal_id, 'SUSPENSION', p_motivo);
    -- El PROPAGADOR aplica el veredicto en la BD del tenant:
    --   UPDATE tienda.estado_tenants SET activo = false WHERE negocio_id = <negocio_id>;
    -- (RLS con fn_sesion_permitida hace cumplir el corte: sin lectura ni escritura.)
END $$;
COMMENT ON FUNCTION portal.fn_suspender(integer, text) IS 'Ordena la suspensión comercial; el propagador la aplica a la BD del tenant.';

CREATE OR REPLACE FUNCTION portal.fn_reactivar(p_negocio_portal_id integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    n record;
BEGIN
    SELECT * INTO n FROM portal.negocios_portal WHERE id = p_negocio_portal_id;
    IF n.id IS NULL THEN
        RAISE EXCEPTION 'El registro % no existe en el portal', p_negocio_portal_id USING ERRCODE = 'P0002';
    END IF;
    UPDATE portal.negocios_portal
       SET estado = CASE WHEN vence_el >= current_date THEN 'ACTIVO' ELSE 'MORA' END
     WHERE id = p_negocio_portal_id;
    INSERT INTO portal.eventos_portal (negocio_portal_id, tipo, detalle)
    VALUES (p_negocio_portal_id, 'REACTIVACION',
            CASE WHEN n.vence_el >= current_date THEN 'al día' ELSE 'queda en mora: venció el ' || n.vence_el END);
    -- El propagador restaura: UPDATE tienda.estado_tenants SET activo = true ...
END $$;
COMMENT ON FUNCTION portal.fn_reactivar(integer) IS 'Reactiva una tienda suspendida: ACTIVO si está pagado, MORA si sigue vencida.';

-- ── Lecturas del panel ───────────────────────────────────────────────────────
CREATE OR REPLACE VIEW portal.v_cartera AS
SELECT n.id, n.subdominio, n.negocio_id, n.db_host || ':' || n.db_puerto || '/' || n.db_nombre AS bd,
       p.nombre AS plan, p.precio_usd, n.estado, n.vence_el,
       (n.vence_el - current_date) AS dias_para_vencer,
       n.estado IN ('MORA', 'SUSPENDIDO') AS requiere_accion
  FROM portal.negocios_portal n LEFT JOIN portal.planes p ON p.id = n.plan_id
 ORDER BY n.estado, n.vence_el NULLS LAST, n.subdominio;

CREATE OR REPLACE VIEW portal.v_mrr AS
SELECT COALESCE(SUM(p.precio_usd) FILTER (WHERE n.estado = 'ACTIVO'), 0) AS mrr_usd,
       count(*) FILTER (WHERE n.estado = 'ACTIVO') AS activos,
       count(*) FILTER (WHERE n.estado = 'PRUEBA') AS en_prueba,
       count(*) FILTER (WHERE n.estado = 'MORA') AS en_mora,
       count(*) FILTER (WHERE n.estado = 'SUSPENDIDO') AS suspendidos
  FROM portal.negocios_portal n LEFT JOIN portal.planes p ON p.id = n.plan_id;
COMMENT ON VIEW portal.v_mrr IS 'Ingreso mensual recurrente y embudo de estados, para la portada del panel.';

-- ── Planes de arranque ───────────────────────────────────────────────────────
INSERT INTO portal.planes (nombre, precio_usd, max_usuarios, max_productos, modulos, notas) VALUES
    ('BASE',     0.00,  3,  200, '{}'::jsonb, 'Tienda única de arranque, sin verticales'),
    ('PRACTICA', 15.00, 5,  300, '{"repuestos": true}'::jsonb, 'Un local con verticales de repuestos'),
    ('PRO',      35.00, 15, 5000, '{"repuestos": true, "ropa": true}'::jsonb, 'Multi-local, todos los verticales')
ON CONFLICT (nombre) DO NOTHING;
