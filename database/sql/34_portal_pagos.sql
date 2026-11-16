--  Archivo 34 · PORTAL DE PAGOS — planes comerciales, cuentas de cobro y verificación humana
--
--  Se ejecuta en la BASE DEL PORTAL (portal_saas), como el 33.
--
--   · Planes de venta: SISTEMA 60 USD/mes (sin fiscal/contable/ISLR), ESPECIAL 80 USD/mes
--     (con módulo fiscal para contribuyentes especiales) y DEMO 0 con 15 días gratis.
--   · El cliente paga por pago móvil o transferencia (Bs o USD) y REPORTA su pago:
--     solicitudes_pago en estado REPORTADO, con monto y tasa congelados al reportar.
--   · El administrador del portal verifica cada reporte contra su estado de cuenta
--     bancario: fn_verificar_pago aprueba (→ fn_registrar_cobro → ACTIVO) o rechaza
--     con motivo. Unicidad (banco_origen, referencia) bloquea pagos reportados dos veces.
--   · La tasa del día la publica el administrador (fn_publicar_tasa); vive en portal.config.

CREATE TABLE IF NOT EXISTS portal.cuentas_banco (
    id          serial PRIMARY KEY,
    banco       text    NOT NULL,
    tipo_cuenta text    NOT NULL DEFAULT 'corriente',
    numero      text    NOT NULL,
    titular     text    NOT NULL,
    rif_titular text    NOT NULL,
    moneda      text    NOT NULL CHECK (moneda IN ('BS', 'USD')),
    activo      boolean NOT NULL DEFAULT true,
    notas       text,
    creado_en   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE portal.cuentas_banco IS 'Cuentas de cobro del portal que la página de pago muestra al cliente (pago móvil / transferencia en Bs o USD). Solo las edita el portal.';

CREATE TABLE IF NOT EXISTS portal.config (
    clave text PRIMARY KEY,
    valor text NOT NULL,
    actualizado_en timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE portal.config IS 'Configuración del portal: tasa_usd_ves del día, dias_gracia de mora (3), textos de instrucciones.';

INSERT INTO portal.config (clave, valor) VALUES
    ('dias_gracia', '3'),
    ('instrucciones', 'Paga por pago móvil o transferencia y reporta tu pago con el número de referencia. Verificamos cada pago contra el estado de cuenta, normalmente el mismo día.')
ON CONFLICT (clave) DO NOTHING;

CREATE TABLE IF NOT EXISTS portal.solicitudes_pago (
    id                serial PRIMARY KEY,
    negocio_portal_id integer NOT NULL REFERENCES portal.negocios_portal(id) ON DELETE CASCADE,
    periodo           date NOT NULL,                 -- primer día del mes que se paga
    moneda            text NOT NULL CHECK (moneda IN ('BS', 'USD')),
    monto_usd         numeric(10,2) NOT NULL,        -- precio del plan, congelado al reportar
    monto_bs          numeric(14,2),                 -- si se pagó en Bs: precio × tasa del día
    tasa_aplicada     numeric(14,4),                 -- tasa vigente cuando se reportó
    banco_origen      text NOT NULL,                 -- banco desde el que el cliente pagó
    referencia        text NOT NULL,                 -- número de referencia o serial del pago
    pagado_el         date NOT NULL,
    nota              text,
    estado            text NOT NULL DEFAULT 'REPORTADO'
                      CHECK (estado IN ('REPORTADO', 'VERIFICADO', 'RECHAZADO')),
    verificado_en     timestamptz,
    verificado_por    text,
    rechazo_motivo    text,
    creado_en         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (banco_origen, referencia)
);
CREATE INDEX IF NOT EXISTS ix_solicitudes_pago_pendientes
    ON portal.solicitudes_pago (estado, creado_en) WHERE estado = 'REPORTADO';
COMMENT ON TABLE portal.solicitudes_pago IS 'Pagos que el cliente reporta (pago móvil o transferencia). El administrador verifica 1 a 1 contra el estado de cuenta: REPORTADO → VERIFICADO (activa la suscripción vía fn_registrar_cobro) o RECHAZADO con motivo.';

-- ── Planes de venta del SaaS ─────────────────────────────────────────────
-- Reemplazan a los planes de prueba (BASE/PRACTICA/PRO quedan para los
-- registros antiguos; las altas nuevas usan los de abajo). "modulos" es el
-- jsonb que el portal escribe en tienda.estado_tenants.modulos al cambiar de
-- plan: ESPECIAL y DEMO llevan {"fiscal": true}; SISTEMA no (sin fiscal/ISLR).
-- La prueba gratis de 15 días la fija fn_alta_tenant para cualquier alta nueva.

INSERT INTO portal.planes (nombre, precio_usd, max_usuarios, max_productos, modulos, notas) VALUES
    ('SISTEMA',  60.00, 200,  5000, '{}'::jsonb,
     'Todo el sistema operativo: POS, caja, inventario, compras, encargos, CxC y reportes. Sin módulos fiscal, contable ni ISLR.'),
    ('ESPECIAL', 80.00, 500, 10000, '{"repuestos": true, "ropa": true, "fiscal": true}'::jsonb,
     'Para contribuyentes especiales: todo lo del Plan Sistema más libros fiscales, retenciones de IVA e ISLR, calendario SENIAT y contabilidad.'),
    ('DEMO',      0.00, 100,   500, '{"repuestos": true, "fiscal": true}'::jsonb,
     'Evaluación gratis 15 días con todo habilitado, incluida la parte fiscal.')
ON CONFLICT (nombre) DO UPDATE
    SET precio_usd = EXCLUDED.precio_usd, max_usuarios = EXCLUDED.max_usuarios,
        max_productos = EXCLUDED.max_productos, modulos = EXCLUDED.modulos,
        notas = EXCLUDED.notas;

-- ── Funciones ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION portal.fn_publicar_tasa(p_tasa numeric) RETURNS numeric
LANGUAGE plpgsql AS $$
BEGIN
    IF p_tasa IS NULL OR p_tasa <= 0 THEN
        RAISE EXCEPTION 'La tasa debe ser un número mayor que cero';
    END IF;
    INSERT INTO portal.config (clave, valor, actualizado_en) VALUES ('tasa_usd_ves', p_tasa::text, now())
        ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now();
    RETURN p_tasa;
END $$;
COMMENT ON FUNCTION portal.fn_publicar_tasa(numeric) IS 'Publica la tasa USD→VES del día que se usa para convertir los pagos en bolívares. La fija el administrador del portal.';

CREATE OR REPLACE FUNCTION portal.fn_tasa_vigente() RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE v text;
BEGIN
    SELECT valor INTO v FROM portal.config WHERE clave = 'tasa_usd_ves';
    RETURN NULLIF(v, '')::numeric;
END $$;
COMMENT ON FUNCTION portal.fn_tasa_vigente() IS 'Tasa USD→VES publicada (NULL si el administrador aún no la fijó: no se pueden reportar pagos en Bs).';

CREATE OR REPLACE FUNCTION portal.fn_reportar_pago(p_negocio_portal_id integer, p_periodo date,
        p_moneda text, p_banco_origen text, p_referencia text, p_pagado_el date,
        p_nota text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    n record;
    v_tasa numeric;
    v_id integer;
    v_moneda text := upper(COALESCE(p_moneda, ''));
BEGIN
    SELECT np.*, pl.precio_usd INTO n FROM portal.negocios_portal np
        JOIN portal.planes pl ON pl.id = np.plan_id WHERE np.id = p_negocio_portal_id;
    IF n.id IS NULL THEN
        RAISE EXCEPTION 'El registro % no existe en el portal', p_negocio_portal_id USING ERRCODE = 'P0002';
    END IF;
    IF v_moneda NOT IN ('BS', 'USD') THEN
        RAISE EXCEPTION 'La moneda debe ser Bs o USD';
    END IF;
    IF n.precio_usd = 0 THEN
        RAISE EXCEPTION 'Tu demo es gratis: elige un plan para pagar (Sistema 60 USD o Especial 80 USD)';
    END IF;
    IF p_banco_origen IS NULL OR trim(p_banco_origen) = '' OR p_referencia IS NULL OR trim(p_referencia) = '' THEN
        RAISE EXCEPTION 'Indica el banco y el número de referencia de tu pago';
    END IF;
    IF v_moneda = 'BS' THEN
        v_tasa := portal.fn_tasa_vigente();
        IF v_tasa IS NULL THEN
            RAISE EXCEPTION 'Aún no hay tasa del día publicada: paga en USD o espera a que se publique la tasa';
        END IF;
    END IF;
    BEGIN
        INSERT INTO portal.solicitudes_pago (negocio_portal_id, periodo, moneda, monto_usd, monto_bs,
                    tasa_aplicada, banco_origen, referencia, pagado_el, nota)
        VALUES (p_negocio_portal_id, date_trunc('month', p_periodo)::date, v_moneda, n.precio_usd,
                CASE WHEN v_moneda = 'BS' THEN round(n.precio_usd * v_tasa, 2) END, v_tasa,
                trim(p_banco_origen), trim(p_referencia), COALESCE(p_pagado_el, current_date), p_nota)
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'Esa referencia ya fue reportada antes: revisa el número de tu pago o escribe a soporte';
    END;
    INSERT INTO portal.eventos_portal (negocio_portal_id, tipo, detalle)
    VALUES (p_negocio_portal_id, 'PAGO_REPORTADO',
            v_moneda || ' · ref ' || trim(p_referencia) || ' · ' || trim(p_banco_origen));
    RETURN v_id;
END $$;
COMMENT ON FUNCTION portal.fn_reportar_pago(integer, date, text, text, text, date, text) IS 'El cliente reporta su pago móvil o transferencia: crea la solicitud en REPORTADO con monto y tasa congelados. El período se normaliza al primer día del mes.';

CREATE OR REPLACE FUNCTION portal.fn_verificar_pago(p_solicitud_id integer, p_aprobar boolean,
        p_verificado_por text, p_motivo text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    s record;
BEGIN
    SELECT * INTO s FROM portal.solicitudes_pago WHERE id = p_solicitud_id;
    IF s.id IS NULL THEN
        RAISE EXCEPTION 'La solicitud % no existe', p_solicitud_id USING ERRCODE = 'P0002';
    END IF;
    IF s.estado <> 'REPORTADO' THEN
        RAISE EXCEPTION 'La solicitud ya está %', s.estado;
    END IF;
    IF NOT p_aprobar AND COALESCE(trim(p_motivo), '') = '' THEN
        RAISE EXCEPTION 'Escribe el motivo del rechazo para que el cliente sepa qué corregir';
    END IF;
    IF p_aprobar THEN
        UPDATE portal.solicitudes_pago
           SET estado = 'VERIFICADO', verificado_en = now(), verificado_por = p_verificado_por,
               rechazo_motivo = NULL
         WHERE id = p_solicitud_id;
        -- El cobro queda registrado (UNIQUE por período) y la suscripción pasa a ACTIVO.
        PERFORM portal.fn_registrar_cobro(s.negocio_portal_id, s.periodo, s.monto_usd,
            CASE WHEN s.moneda = 'BS' THEN 'pago móvil' ELSE 'transferencia USD' END,
            'ref ' || s.referencia || ' (' || lower(s.banco_origen) || ')');
    ELSE
        UPDATE portal.solicitudes_pago
           SET estado = 'RECHAZADO', verificado_en = now(), verificado_por = p_verificado_por,
               rechazo_motivo = trim(p_motivo)
         WHERE id = p_solicitud_id;
        INSERT INTO portal.eventos_portal (negocio_portal_id, tipo, detalle)
        VALUES (s.negocio_portal_id, 'PAGO_RECHAZADO', 'ref ' || s.referencia || ' · ' || trim(p_motivo));
    END IF;
END $$;
COMMENT ON FUNCTION portal.fn_verificar_pago(integer, boolean, text, text) IS 'Veredicto humano sobre un pago reportado: aprobar → fn_registrar_cobro (ACTIVO, vence fin de mes); rechazar → motivo visible para el cliente.';

-- Cambiar de plan (up/down-grade): escribe también el veredicto en la base de la tienda.
CREATE OR REPLACE FUNCTION portal.fn_cambiar_plan(p_negocio_portal_id integer, p_plan text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE n record; v_plan record;
BEGIN
    SELECT * INTO n FROM portal.negocios_portal WHERE id = p_negocio_portal_id;
    IF n.id IS NULL THEN
        RAISE EXCEPTION 'El registro % no existe en el portal', p_negocio_portal_id USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_plan FROM portal.planes WHERE nombre = upper(p_plan);
    IF v_plan.id IS NULL THEN
        RAISE EXCEPTION 'El plan «%» no existe', p_plan USING ERRCODE = 'P0002';
    END IF;
    UPDATE portal.negocios_portal SET plan_id = v_plan.id WHERE id = p_negocio_portal_id;
    INSERT INTO portal.eventos_portal (negocio_portal_id, tipo, detalle)
    VALUES (p_negocio_portal_id, 'PLAN', 'cambio a ' || upper(p_plan) || ' (' || v_plan.precio_usd || ' USD/mes)');
    -- El estado teniente se sincroniza con el propagador diario (comando portal:propagar).
END $$;
COMMENT ON FUNCTION portal.fn_cambiar_plan(integer, text) IS 'Cambia el plan de una tienda (SISTEMA / ESPECIAL / DEMO). El propagador escribe plan y módulos en estado_tenants.';

CREATE OR REPLACE VIEW portal.v_solicitudes_pendientes AS
SELECT s.id, s.negocio_portal_id, n.subdominio, s.periodo, s.moneda, s.monto_usd, s.monto_bs,
       s.tasa_aplicada, s.banco_origen, s.referencia, s.pagado_el, s.nota, s.creado_en,
       pl.nombre AS plan
FROM portal.solicitudes_pago s
JOIN portal.negocios_portal n ON n.id = s.negocio_portal_id
JOIN portal.planes pl ON pl.id = n.plan_id
WHERE s.estado = 'REPORTADO'
ORDER BY s.creado_en;
COMMENT ON VIEW portal.v_solicitudes_pendientes IS 'Cola de pagos reportados esperando verificación humana (panel del portal).';
