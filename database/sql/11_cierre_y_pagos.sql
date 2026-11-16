-- =============================================================================
--  11 · Cierre y pagos (OPCIONAL; requiere 08_retenciones_iva.sql y 10_contabilidad.sql)
-- =============================================================================
--  Agrega:
--    1. Compras a crédito y pagos a proveedores (cuentas por pagar): compras.condicion_pago / dias_credito / fecha_vencimiento,
--       proveedores.dias_credito, pagos_proveedor (+ aplicaciones a facturas), vista v_cuentas_por_pagar.
--    2. Bloqueo de períodos contables: un mes cerrado no admite asientos, ni anular ventas o compras de ese mes, ni registrar compras o ventas con fecha en él.
--    3. Retenciones de IVA enteradas por quincena (1–15 y 16–fin de mes): qué debes enterar y qué ya enteraste.
--    4. Cierre de ejercicio: asiento «CIERRE» que deja en cero ingresos y gastos y lleva la diferencia a 3.1.02 Resultados acumulados.
--    5. Ajuste por diferencial cambiario del inventario (Bs al tipo de cambio del cierre vs. saldo contable).
--  Los asientos de pagos y ajustes solo se generan si la contabilidad automática está activa.
--  Las cuentas y el tratamiento contable (sobre todo el ajuste cambiario y el cierre) son una propuesta: revísalos con tu contador.
--     psql -d tienda -f 11_cierre_y_pagos.sql
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  0. Tipos de asiento nuevos, cuentas y parámetros
-- ---------------------------------------------------------------------------
ALTER TABLE asientos DROP CONSTRAINT IF EXISTS asientos_origen_tipo_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN
    ('MANUAL','APERTURA','VENTA','ANULACION_VENTA','COMPRA','ANULACION_COMPRA','NOTA_CREDITO','NOTA_DEBITO','DEVOLUCION_COSTO','PAGO_PROVEEDOR','ANULACION_PAGO','CIERRE','AJUSTE_CAMBIARIO'));

INSERT INTO plan_cuentas (codigo, nombre, tipo, cuenta_padre_id, permite_movimiento)
SELECT '5.2.03', 'Diferencial cambiario', 'GASTO', (SELECT id FROM plan_cuentas WHERE codigo = '5.2'), true
 WHERE NOT EXISTS (SELECT 1 FROM plan_cuentas WHERE codigo = '5.2.03');
COMMENT ON COLUMN plan_cuentas.tipo IS 'ACTIVO y GASTO tienen saldo deudor; PASIVO, PATRIMONIO e INGRESO, acreedor. «Diferencial cambiario» (5.2.03) es de tipo GASTO: si su saldo queda acreedor, es ganancia.';

INSERT INTO contab_parametros (clave, cuenta_id, nota)
SELECT x.clave, (SELECT id FROM plan_cuentas WHERE codigo = x.codigo), x.nota
  FROM (VALUES ('DIFERENCIAL_CAMBIARIO','5.2.03','Ganancia o pérdida por diferencia de tasas (pagos a proveedores y ajuste del inventario)'),
               ('RESULTADOS_ACUM','3.1.02','Donde se lleva el resultado al cerrar el ejercicio')) AS x(clave, codigo, nota)
ON CONFLICT (clave) DO NOTHING;

-- ---------------------------------------------------------------------------
--  1. COMPRAS A CRÉDITO Y PAGOS A PROVEEDORES
-- ---------------------------------------------------------------------------
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS dias_credito smallint NOT NULL DEFAULT 0 CHECK (dias_credito BETWEEN 0 AND 365);
COMMENT ON COLUMN proveedores.dias_credito IS 'Días de crédito que suele dar este proveedor (0 = contado). Solo sugiere el plazo al registrar una compra.';

ALTER TABLE compras ADD COLUMN IF NOT EXISTS condicion_pago    varchar(7) NOT NULL DEFAULT 'CONTADO' CHECK (condicion_pago IN ('CONTADO','CREDITO'));
ALTER TABLE compras ADD COLUMN IF NOT EXISTS dias_credito      smallint   NOT NULL DEFAULT 0 CHECK (dias_credito BETWEEN 0 AND 365);
ALTER TABLE compras ADD COLUMN IF NOT EXISTS fecha_vencimiento date;
DO $$ BEGIN
    ALTER TABLE compras ADD CONSTRAINT ck_compras_vencimiento CHECK ((condicion_pago = 'CREDITO') = (fecha_vencimiento IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN compras.condicion_pago IS 'CONTADO: ya se pagó, no genera deuda. CREDITO: queda por pagar hasta fecha_vencimiento (fecha de la factura + días de crédito).';

-- Marca una compra como a crédito. Solo en la misma transacción que la crea (la cabecera es inmutable después).
CREATE OR REPLACE FUNCTION fn_compra_a_credito(p_compra_id bigint, p_dias int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_dias IS NULL OR p_dias < 0 OR p_dias > 365 THEN RAISE EXCEPTION 'Los días de crédito van de 0 a 365' USING ERRCODE = 'TV006'; END IF;
    UPDATE compras SET condicion_pago = 'CREDITO', dias_credito = p_dias, fecha_vencimiento = fecha_factura + p_dias WHERE id = p_compra_id;
END $$;

CREATE TABLE IF NOT EXISTS pagos_proveedor (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    proveedor_id     bigint        NOT NULL REFERENCES proveedores(id),
    fecha            date          NOT NULL,
    moneda           char(3)       NOT NULL REFERENCES monedas(codigo),
    monto            numeric(18,2) NOT NULL CHECK (monto > 0),
    tasa_usd         numeric(20,8) NOT NULL CHECK (tasa_usd > 0),     -- 1 unidad de la moneda del pago, en USD, ese día
    tasa_ves         numeric(20,8) NOT NULL CHECK (tasa_ves > 0),     -- ídem en Bs
    monto_usd        numeric(18,2) NOT NULL CHECK (monto_usd > 0),
    monto_ves        numeric(18,2) NOT NULL CHECK (monto_ves > 0),
    referencia       varchar(60),
    fondos           varchar(6)    NOT NULL CHECK (fondos IN ('CAJA','BANCOS')),
    observaciones    text,
    estado           varchar(7)    NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','ANULADO')),
    usuario_id       bigint        REFERENCES usuarios(id),
    created_at       timestamptz   NOT NULL DEFAULT now(),
    anulado_en       timestamptz,
    anulado_por      bigint        REFERENCES usuarios(id),
    motivo_anulacion text
);
CREATE INDEX IF NOT EXISTS ix_pagos_proveedor ON pagos_proveedor (proveedor_id, fecha);

CREATE TABLE IF NOT EXISTS pagos_proveedor_aplicacion (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pago_id    bigint        NOT NULL REFERENCES pagos_proveedor(id),
    compra_id  bigint        NOT NULL REFERENCES compras(id),
    monto_usd  numeric(18,2) NOT NULL CHECK (monto_usd > 0)
);
CREATE INDEX IF NOT EXISTS ix_pagos_aplic_compra ON pagos_proveedor_aplicacion (compra_id);

CREATE OR REPLACE FUNCTION trg_pagos_proveedor_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Un pago no se borra: anúlelo' USING ERRCODE = 'TV005'; END IF;
    IF OLD.estado = 'ACTIVO' AND NEW.estado = 'ANULADO' AND NEW.proveedor_id = OLD.proveedor_id AND NEW.fecha = OLD.fecha AND NEW.monto = OLD.monto
       AND NEW.monto_usd = OLD.monto_usd AND NEW.monto_ves = OLD.monto_ves AND NEW.moneda = OLD.moneda THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Un pago no se puede modificar: solo puede anularse' USING ERRCODE = 'TV005';
END $$;
DROP TRIGGER IF EXISTS trg_pagos_proveedor_guardia ON pagos_proveedor;
CREATE TRIGGER trg_pagos_proveedor_guardia BEFORE UPDATE OR DELETE ON pagos_proveedor FOR EACH ROW EXECUTE FUNCTION trg_pagos_proveedor_guardia();

CREATE OR REPLACE FUNCTION trg_pagos_aplic_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Las aplicaciones de un pago no se modifican: anule el pago' USING ERRCODE = 'TV005'; END $$;
DROP TRIGGER IF EXISTS trg_pagos_aplic_inmutable ON pagos_proveedor_aplicacion;
CREATE TRIGGER trg_pagos_aplic_inmutable BEFORE UPDATE OR DELETE ON pagos_proveedor_aplicacion FOR EACH ROW EXECUTE FUNCTION trg_pagos_aplic_inmutable();

-- Lo que se debe: una fila por compra a crédito registrada. Los pagos anulados no cuentan.
CREATE OR REPLACE VIEW v_cuentas_por_pagar AS
SELECT c.id AS compra_id, c.proveedor_id, c.numero_factura, c.fecha_factura, c.fecha_vencimiento, c.dias_credito, c.total_usd,
       COALESCE(a.pagado, 0) AS pagado_usd, c.total_usd - COALESCE(a.pagado, 0) AS saldo_usd,
       c.fecha_vencimiento - fn_hoy() AS dias_para_vencer
  FROM compras c
  LEFT JOIN LATERAL (SELECT sum(x.monto_usd) AS pagado FROM pagos_proveedor_aplicacion x JOIN pagos_proveedor p ON p.id = x.pago_id
                      WHERE x.compra_id = c.id AND p.estado = 'ACTIVO') a ON true
 WHERE c.estado = 'REGISTRADA' AND c.condicion_pago = 'CREDITO';
COMMENT ON VIEW v_cuentas_por_pagar IS 'Compras a crédito con su saldo en USD. dias_para_vencer negativo = vencida.';

-- Registra un pago y lo aplica a una factura (p_compra_id) o, si es NULL, a las más antiguas primero (por vencimiento).
CREATE OR REPLACE FUNCTION fn_registrar_pago_proveedor(
    p_proveedor_id bigint, p_fecha date, p_moneda char(3), p_monto numeric, p_referencia text, p_fondos text,
    p_compra_id bigint, p_usuario_id bigint, p_observaciones text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    v_id bigint; t_usd numeric; t_ves numeric; m_usd numeric; m_ves numeric; saldo_total numeric; restante numeric; aplicar numeric;
    c record; tv numeric; deb_ves numeric := 0; sin_asiento boolean := false; dif numeric; lineas jsonb;
BEGIN
    IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto del pago debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha IS NULL OR p_fecha > fn_hoy() THEN RAISE EXCEPTION 'La fecha del pago no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF p_fondos NOT IN ('CAJA','BANCOS') THEN RAISE EXCEPTION 'Indica de dónde salió el dinero: caja o bancos' USING ERRCODE = 'TV006'; END IF;
    IF fn_periodo_cerrado(p_fecha) THEN RAISE EXCEPTION 'La fecha del pago cae en un período contable cerrado (%)', to_char(p_fecha, 'MM/YYYY') USING ERRCODE = 'TV005'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('tienda.pagos_proveedor.' || p_proveedor_id));
    IF NOT EXISTS (SELECT 1 FROM proveedores WHERE id = p_proveedor_id) THEN RAISE EXCEPTION 'El proveedor no existe' USING ERRCODE = 'TV006'; END IF;

    t_usd := CASE WHEN p_moneda = 'USD' THEN 1 ELSE fn_tasa_par(p_moneda, 'USD', p_fecha) END;
    t_ves := CASE WHEN p_moneda = 'VES' THEN 1 ELSE fn_tasa_par(p_moneda, 'VES', p_fecha) END;
    m_usd := ROUND(p_monto * t_usd, 2);  m_ves := ROUND(p_monto * t_ves, 2);
    IF m_usd <= 0 OR m_ves <= 0 THEN RAISE EXCEPTION 'El monto es demasiado pequeño' USING ERRCODE = 'TV006'; END IF;

    SELECT COALESCE(sum(saldo_usd), 0) INTO saldo_total FROM v_cuentas_por_pagar
     WHERE proveedor_id = p_proveedor_id AND saldo_usd > 0 AND (p_compra_id IS NULL OR compra_id = p_compra_id);
    IF saldo_total = 0 THEN
        RAISE EXCEPTION '%', CASE WHEN p_compra_id IS NULL THEN 'Este proveedor no tiene facturas a crédito pendientes' ELSE 'Esa factura no tiene saldo pendiente' END USING ERRCODE = 'TV006';
    END IF;
    IF m_usd > saldo_total + 0.01 THEN
        RAISE EXCEPTION 'El pago (US$ %) es mayor que lo que le debes (US$ %)', to_char(m_usd, 'FM999G999G990D00'), to_char(saldo_total, 'FM999G999G990D00') USING ERRCODE = 'TV006';
    END IF;
    IF m_usd > saldo_total THEN m_usd := saldo_total; END IF;

    INSERT INTO pagos_proveedor (proveedor_id, fecha, moneda, monto, tasa_usd, tasa_ves, monto_usd, monto_ves, referencia, fondos, observaciones, usuario_id)
    VALUES (p_proveedor_id, p_fecha, p_moneda, p_monto, t_usd, t_ves, m_usd, m_ves, NULLIF(trim(p_referencia), ''), p_fondos, NULLIF(trim(p_observaciones), ''), p_usuario_id)
    RETURNING id INTO v_id;

    restante := m_usd;
    FOR c IN SELECT * FROM v_cuentas_por_pagar WHERE proveedor_id = p_proveedor_id AND saldo_usd > 0 AND (p_compra_id IS NULL OR compra_id = p_compra_id)
              ORDER BY fecha_vencimiento, fecha_factura, compra_id LOOP
        EXIT WHEN restante <= 0;
        aplicar := LEAST(restante, c.saldo_usd);
        INSERT INTO pagos_proveedor_aplicacion (pago_id, compra_id, monto_usd) VALUES (v_id, c.compra_id, aplicar);
        restante := restante - aplicar;
        SELECT total_ves INTO tv FROM v_libro_compras WHERE compra_id = c.compra_id;
        IF tv IS NULL OR NOT EXISTS (SELECT 1 FROM asientos WHERE origen_tipo = 'COMPRA' AND origen_id = c.compra_id) THEN sin_asiento := true;
        ELSE deb_ves := deb_ves + ROUND(aplicar / c.total_usd * tv, 2); END IF;
    END LOOP;

    -- Asiento: Debe Cuentas por pagar (a la tasa de la factura) / Haber Caja o Bancos (a la tasa del pago); la diferencia es diferencial cambiario.
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) AND NOT sin_asiento AND deb_ves > 0 THEN
        lineas := jsonb_build_array(
            jsonb_build_object('cuenta_id', fn_cuenta_param('CUENTAS_POR_PAGAR'), 'debe', deb_ves, 'glosa', 'Pago a proveedor'),
            jsonb_build_object('cuenta_id', fn_cuenta_param(p_fondos), 'haber', m_ves, 'glosa', COALESCE('Ref. ' || NULLIF(trim(p_referencia), ''), 'Pago a proveedor')));
        dif := deb_ves - m_ves;
        IF dif > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('DIFERENCIAL_CAMBIARIO'), 'haber', dif, 'glosa', 'Diferencial cambiario (ganancia)');
        ELSIF dif < 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('DIFERENCIAL_CAMBIARIO'), 'debe', -dif, 'glosa', 'Diferencial cambiario (pérdida)'); END IF;
        PERFORM fn_crear_asiento(p_fecha, 'Pago a proveedor N.º ' || v_id, 'PAGO_PROVEEDOR', v_id, lineas, p_usuario_id);
    END IF;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_anular_pago_proveedor(p_pago_id bigint, p_motivo text, p_usuario_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p pagos_proveedor;
BEGIN
    SELECT * INTO p FROM pagos_proveedor WHERE id = p_pago_id FOR UPDATE;
    IF p.id IS NULL THEN RAISE EXCEPTION 'El pago no existe' USING ERRCODE = 'TV006'; END IF;
    IF p.estado = 'ANULADO' THEN RAISE EXCEPTION 'Ese pago ya está anulado' USING ERRCODE = 'TV006'; END IF;
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    IF fn_periodo_cerrado(p.fecha) THEN RAISE EXCEPTION 'El pago es de un período contable cerrado (%): no se puede anular', to_char(p.fecha, 'MM/YYYY') USING ERRCODE = 'TV005'; END IF;
    UPDATE pagos_proveedor SET estado = 'ANULADO', anulado_en = now(), anulado_por = p_usuario_id, motivo_anulacion = trim(p_motivo) WHERE id = p_pago_id;
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN
        PERFORM fn_contra_asiento('PAGO_PROVEEDOR', p_pago_id, 'ANULACION_PAGO', fn_hoy(), 'Anulación del pago a proveedor N.º ' || p_pago_id, p_usuario_id);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
--  2. BLOQUEO DE PERÍODOS CONTABLES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS periodos_contables (
    periodo     date PRIMARY KEY CHECK (periodo = date_trunc('month', periodo)::date),    -- primer día del mes
    estado      varchar(7)  NOT NULL DEFAULT 'CERRADO' CHECK (estado IN ('CERRADO','ABIERTO')),
    cerrado_por bigint      REFERENCES usuarios(id),
    cerrado_en  timestamptz NOT NULL DEFAULT now(),
    nota        text
);
CREATE TABLE IF NOT EXISTS periodos_contables_log (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    periodo    date        NOT NULL,
    accion     varchar(7)  NOT NULL CHECK (accion IN ('CERRAR','REABRIR')),
    usuario_id bigint      REFERENCES usuarios(id),
    nota       text,
    created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE periodos_contables IS 'Meses cerrados. En un mes CERRADO no se insertan asientos, no se anulan ventas ni compras de ese mes y no se registran compras con fecha en él.';

CREATE OR REPLACE FUNCTION fn_periodo_cerrado(p_fecha date) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM periodos_contables WHERE periodo = date_trunc('month', p_fecha)::date AND estado = 'CERRADO')
$$;

CREATE OR REPLACE FUNCTION fn_cerrar_periodo(p_periodo date, p_usuario_id bigint, p_nota text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m date := date_trunc('month', p_periodo)::date;
BEGIN
    IF (m + interval '1 month - 1 day')::date >= fn_hoy() THEN RAISE EXCEPTION 'Solo se puede cerrar un mes que ya terminó' USING ERRCODE = 'TV006'; END IF;
    IF fn_periodo_cerrado(m) THEN RAISE EXCEPTION 'Ese período ya está cerrado' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO periodos_contables (periodo, estado, cerrado_por, cerrado_en, nota) VALUES (m, 'CERRADO', p_usuario_id, now(), NULLIF(trim(p_nota), ''))
    ON CONFLICT (periodo) DO UPDATE SET estado = 'CERRADO', cerrado_por = EXCLUDED.cerrado_por, cerrado_en = now(), nota = EXCLUDED.nota;
    INSERT INTO periodos_contables_log (periodo, accion, usuario_id, nota) VALUES (m, 'CERRAR', p_usuario_id, NULLIF(trim(p_nota), ''));
END $$;

CREATE OR REPLACE FUNCTION fn_reabrir_periodo(p_periodo date, p_usuario_id bigint, p_motivo text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m date := date_trunc('month', p_periodo)::date;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN RAISE EXCEPTION 'Escribe por qué reabres el período (queda registrado)' USING ERRCODE = 'TV006'; END IF;
    IF NOT fn_periodo_cerrado(m) THEN RAISE EXCEPTION 'Ese período no está cerrado' USING ERRCODE = 'TV006'; END IF;
    UPDATE periodos_contables SET estado = 'ABIERTO' WHERE periodo = m;
    INSERT INTO periodos_contables_log (periodo, accion, usuario_id, nota) VALUES (m, 'REABRIR', p_usuario_id, trim(p_motivo));
END $$;

-- Asientos: ninguno con fecha en un mes cerrado (el asiento de CIERRE del ejercicio sí puede ir, se hace después de cerrar diciembre).
CREATE OR REPLACE FUNCTION trg_periodo_asiento() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.origen_tipo <> 'CIERRE' AND fn_periodo_cerrado(NEW.fecha) THEN
        RAISE EXCEPTION 'El período % está cerrado: no se pueden registrar asientos con esa fecha', to_char(NEW.fecha, 'MM/YYYY') USING ERRCODE = 'TV005';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_periodo_asiento ON asientos;
CREATE TRIGGER trg_periodo_asiento BEFORE INSERT ON asientos FOR EACH ROW EXECUTE FUNCTION trg_periodo_asiento();

-- Ventas y compras: no se anulan ni se registran con fecha en un mes cerrado.
CREATE OR REPLACE FUNCTION trg_periodo_anular_venta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF fn_periodo_cerrado(OLD.fecha_valor) THEN
        RAISE EXCEPTION 'La venta % es de % (período cerrado): ya no se puede anular. Emite una nota de crédito en el mes actual.', OLD.numero, to_char(OLD.fecha_valor, 'MM/YYYY') USING ERRCODE = 'TV005';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_z_periodo_anular_venta ON ventas;
CREATE TRIGGER trg_z_periodo_anular_venta BEFORE UPDATE OF estado ON ventas FOR EACH ROW WHEN (OLD.estado = 'COMPLETADA' AND NEW.estado = 'ANULADA') EXECUTE FUNCTION trg_periodo_anular_venta();

CREATE OR REPLACE FUNCTION trg_periodo_anular_compra() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF fn_periodo_cerrado(OLD.fecha_factura) THEN
        RAISE EXCEPTION 'La factura % es de % (período cerrado): ya no se puede anular', OLD.numero_factura, to_char(OLD.fecha_factura, 'MM/YYYY') USING ERRCODE = 'TV005';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_z_periodo_anular_compra ON compras;
CREATE TRIGGER trg_z_periodo_anular_compra BEFORE UPDATE OF estado ON compras FOR EACH ROW WHEN (OLD.estado = 'REGISTRADA' AND NEW.estado = 'ANULADA') EXECUTE FUNCTION trg_periodo_anular_compra();

CREATE OR REPLACE FUNCTION trg_periodo_alta_compra() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF fn_periodo_cerrado(NEW.fecha_factura) THEN
        RAISE EXCEPTION 'El período % está cerrado: no se puede registrar una factura con esa fecha', to_char(NEW.fecha_factura, 'MM/YYYY') USING ERRCODE = 'TV005';
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION trg_periodo_alta_venta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.fecha_valor IS NOT NULL AND fn_periodo_cerrado(NEW.fecha_valor) THEN
        RAISE EXCEPTION 'El período % está cerrado: no se puede registrar una venta con esa fecha', to_char(NEW.fecha_valor, 'MM/YYYY') USING ERRCODE = 'TV005';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_z_periodo_alta ON compras;
CREATE TRIGGER trg_z_periodo_alta BEFORE INSERT ON compras FOR EACH ROW EXECUTE FUNCTION trg_periodo_alta_compra();
DROP TRIGGER IF EXISTS trg_z_periodo_alta ON ventas;
CREATE TRIGGER trg_z_periodo_alta BEFORE INSERT ON ventas FOR EACH ROW EXECUTE FUNCTION trg_periodo_alta_venta();
DROP FUNCTION IF EXISTS trg_periodo_alta_documento();

-- ---------------------------------------------------------------------------
--  3. RETENCIONES DE IVA ENTERADAS POR QUINCENA
-- ---------------------------------------------------------------------------
--  Solo las que TÚ practicas a tus proveedores (sentido COMPRA): las que te practican a ti las enteran tus clientes.
--  La quincena se toma de la fecha de emisión del comprobante: 1 = días 1 al 15; 2 = día 16 al fin de mes.
CREATE TABLE IF NOT EXISTS retenciones_enteradas (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    anio          smallint      NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
    mes           smallint      NOT NULL CHECK (mes BETWEEN 1 AND 12),
    quincena      smallint      NOT NULL CHECK (quincena IN (1, 2)),
    monto_ves     numeric(18,2) NOT NULL CHECK (monto_ves > 0),      -- total que tenían las retenciones al marcarlas
    fecha_pago    date          NOT NULL,
    referencia    varchar(60),
    observaciones text,
    estado        varchar(7)    NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA','ANULADA')),
    usuario_id    bigint        REFERENCES usuarios(id),
    created_at    timestamptz   NOT NULL DEFAULT now(),
    anulada_en    timestamptz,
    motivo_anulacion text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ret_enteradas ON retenciones_enteradas (anio, mes, quincena) WHERE estado = 'ACTIVA';

CREATE OR REPLACE FUNCTION fn_retenciones_por_quincena(p_desde date, p_hasta date)
RETURNS TABLE (anio int, mes int, quincena int, desde date, hasta date, comprobantes bigint, iva_retenido_ves numeric, enterada boolean, enterado_id bigint, fecha_pago date, referencia text, monto_enterado numeric)
LANGUAGE sql STABLE AS $$
    WITH r AS (
        SELECT extract(year FROM fecha_emision)::int AS anio, extract(month FROM fecha_emision)::int AS mes,
               CASE WHEN extract(day FROM fecha_emision) <= 15 THEN 1 ELSE 2 END AS q, count(*) AS n, sum(iva_retenido_ves) AS total
          FROM retenciones_iva WHERE sentido = 'COMPRA' AND estado = 'ACTIVA' AND fecha_emision BETWEEN p_desde AND p_hasta GROUP BY 1, 2, 3)
    SELECT r.anio, r.mes, r.q,
           make_date(r.anio, r.mes, CASE WHEN r.q = 1 THEN 1 ELSE 16 END),
           CASE WHEN r.q = 1 THEN make_date(r.anio, r.mes, 15) ELSE (make_date(r.anio, r.mes, 1) + interval '1 month - 1 day')::date END,
           r.n, r.total, (e.id IS NOT NULL), e.id, e.fecha_pago, e.referencia::text, e.monto_ves
      FROM r LEFT JOIN retenciones_enteradas e ON e.anio = r.anio AND e.mes = r.mes AND e.quincena = r.q AND e.estado = 'ACTIVA'
     ORDER BY r.anio, r.mes, r.q
$$;

CREATE OR REPLACE FUNCTION fn_enterar_retenciones(p_anio int, p_mes int, p_quincena int, p_fecha_pago date, p_referencia text, p_usuario_id bigint, p_observaciones text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE d date; h date; total numeric; v_id bigint;
BEGIN
    IF p_quincena NOT IN (1, 2) THEN RAISE EXCEPTION 'La quincena es 1 o 2' USING ERRCODE = 'TV006'; END IF;
    d := make_date(p_anio, p_mes, CASE WHEN p_quincena = 1 THEN 1 ELSE 16 END);
    h := CASE WHEN p_quincena = 1 THEN make_date(p_anio, p_mes, 15) ELSE (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date END;
    IF p_fecha_pago IS NULL OR p_fecha_pago > fn_hoy() THEN RAISE EXCEPTION 'La fecha de pago no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha_pago < d THEN RAISE EXCEPTION 'El pago no puede ser anterior a la quincena' USING ERRCODE = 'TV006'; END IF;
    IF h >= fn_hoy() THEN RAISE EXCEPTION 'Esa quincena todavía no termina' USING ERRCODE = 'TV006'; END IF;
    SELECT sum(iva_retenido_ves) INTO total FROM retenciones_iva WHERE sentido = 'COMPRA' AND estado = 'ACTIVA' AND fecha_emision BETWEEN d AND h;
    IF COALESCE(total, 0) <= 0 THEN RAISE EXCEPTION 'No hay retenciones de IVA en esa quincena' USING ERRCODE = 'TV006'; END IF;
    IF EXISTS (SELECT 1 FROM retenciones_enteradas WHERE anio = p_anio AND mes = p_mes AND quincena = p_quincena AND estado = 'ACTIVA') THEN
        RAISE EXCEPTION 'Esa quincena ya está marcada como enterada' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO retenciones_enteradas (anio, mes, quincena, monto_ves, fecha_pago, referencia, observaciones, usuario_id)
    VALUES (p_anio, p_mes, p_quincena, total, p_fecha_pago, NULLIF(trim(p_referencia), ''), NULLIF(trim(p_observaciones), ''), p_usuario_id) RETURNING id INTO v_id;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_desmarcar_enterada(p_id bigint, p_motivo text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Escribe el motivo' USING ERRCODE = 'TV006'; END IF;
    UPDATE retenciones_enteradas SET estado = 'ANULADA', anulada_en = now(), motivo_anulacion = trim(p_motivo) WHERE id = p_id AND estado = 'ACTIVA';
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa marca no existe o ya fue quitada' USING ERRCODE = 'TV006'; END IF;
END $$;

-- ---------------------------------------------------------------------------
--  4. LIBRO MAYOR SIN EL ASIENTO DE CIERRE (para los resultados del período)
-- ---------------------------------------------------------------------------
--  El asiento CIERRE deja ingresos y gastos en cero: el estado de resultados del año no debe «ver» ese cierre.
CREATE OR REPLACE FUNCTION fn_libro_mayor(p_desde date, p_hasta date, p_incluir_cierre boolean)
RETURNS TABLE (codigo varchar, cuenta text, tipo varchar, naturaleza text, saldo_inicial numeric, debitos numeric, creditos numeric, saldo_final numeric)
LANGUAGE sql STABLE AS $$
    WITH mov AS (
        SELECT d.cuenta_id,
               COALESCE(sum(d.debe)  FILTER (WHERE a.fecha <  p_desde), 0) AS d_ini, COALESCE(sum(d.haber) FILTER (WHERE a.fecha <  p_desde), 0) AS h_ini,
               COALESCE(sum(d.debe)  FILTER (WHERE a.fecha >= p_desde), 0) AS d_per, COALESCE(sum(d.haber) FILTER (WHERE a.fecha >= p_desde), 0) AS h_per
          FROM asiento_detalle d JOIN asientos a ON a.id = d.asiento_id
         WHERE a.fecha <= p_hasta AND (p_incluir_cierre OR a.origen_tipo <> 'CIERRE') GROUP BY d.cuenta_id)
    SELECT c.codigo, c.nombre::text, c.tipo, fn_naturaleza_cuenta(c.tipo),
           CASE WHEN fn_naturaleza_cuenta(c.tipo) = 'DEUDORA' THEN m.d_ini - m.h_ini ELSE m.h_ini - m.d_ini END,
           m.d_per, m.h_per,
           CASE WHEN fn_naturaleza_cuenta(c.tipo) = 'DEUDORA' THEN (m.d_ini + m.d_per) - (m.h_ini + m.h_per) ELSE (m.h_ini + m.h_per) - (m.d_ini + m.d_per) END
      FROM mov m JOIN plan_cuentas c ON c.id = m.cuenta_id ORDER BY c.codigo
$$;

-- ---------------------------------------------------------------------------
--  5. CIERRE DE EJERCICIO
-- ---------------------------------------------------------------------------
--  Para cada cuenta de INGRESO o GASTO con saldo en el año: se salda (si tenía saldo acreedor se debita, si deudor se acredita) y la diferencia va a
--  3.1.02 Resultados acumulados: ganancia = abono, pérdida = cargo. Un solo asiento tipo CIERRE por año, fechado el 31 de diciembre.
CREATE OR REPLACE FUNCTION fn_cierre_ejercicio_vista(p_anio int)
RETURNS TABLE (cuenta_id bigint, codigo varchar, nombre text, tipo varchar, debe numeric, haber numeric)
LANGUAGE sql STABLE AS $$
    WITH s AS (
        SELECT c.id, c.codigo, c.nombre::text AS nombre, c.tipo, sum(d.debe) - sum(d.haber) AS neto
          FROM asiento_detalle d JOIN asientos a ON a.id = d.asiento_id JOIN plan_cuentas c ON c.id = d.cuenta_id
         WHERE c.tipo IN ('INGRESO','GASTO') AND a.fecha BETWEEN make_date(p_anio, 1, 1) AND make_date(p_anio, 12, 31) AND a.origen_tipo <> 'CIERRE'
         GROUP BY c.id, c.codigo, c.nombre, c.tipo HAVING sum(d.debe) - sum(d.haber) <> 0)
    SELECT s.id, s.codigo, s.nombre, s.tipo, CASE WHEN s.neto < 0 THEN -s.neto ELSE 0 END, CASE WHEN s.neto > 0 THEN s.neto ELSE 0 END FROM s ORDER BY s.codigo
$$;

CREATE OR REPLACE FUNCTION fn_cierre_ejercicio(p_anio int, p_usuario_id bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE lineas jsonb := '[]'::jsonb; l record; dl numeric := 0; cl numeric := 0; y int; primero int;
BEGIN
    IF make_date(p_anio, 12, 31) >= fn_hoy() THEN RAISE EXCEPTION 'El ejercicio % todavía no termina: se cierra después del 31 de diciembre', p_anio USING ERRCODE = 'TV006'; END IF;
    IF EXISTS (SELECT 1 FROM asientos WHERE origen_tipo = 'CIERRE' AND origen_id = p_anio) THEN RAISE EXCEPTION 'El ejercicio % ya está cerrado', p_anio USING ERRCODE = 'TV006'; END IF;
    SELECT extract(year FROM min(fecha))::int INTO primero FROM asientos;
    FOR y IN SELECT generate_series(COALESCE(primero, p_anio), p_anio - 1) LOOP
        IF EXISTS (SELECT 1 FROM fn_cierre_ejercicio_vista(y)) AND NOT EXISTS (SELECT 1 FROM asientos WHERE origen_tipo = 'CIERRE' AND origen_id = y) THEN
            RAISE EXCEPTION 'Primero cierra el ejercicio % (tiene ingresos o gastos sin cerrar)', y USING ERRCODE = 'TV006'; END IF;
    END LOOP;
    FOR l IN SELECT * FROM fn_cierre_ejercicio_vista(p_anio) LOOP
        lineas := lineas || jsonb_build_object('cuenta_id', l.cuenta_id, 'debe', l.debe, 'haber', l.haber, 'glosa', 'Cierre de ' || l.codigo || ' ' || l.nombre);
        dl := dl + l.debe; cl := cl + l.haber;
    END LOOP;
    IF jsonb_array_length(lineas) = 0 THEN RAISE EXCEPTION 'El ejercicio % no tiene saldos de ingresos ni gastos que cerrar', p_anio USING ERRCODE = 'TV006'; END IF;
    IF dl > cl THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('RESULTADOS_ACUM'), 'haber', dl - cl, 'glosa', 'Utilidad del ejercicio ' || p_anio);
    ELSIF cl > dl THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('RESULTADOS_ACUM'), 'debe', cl - dl, 'glosa', 'Pérdida del ejercicio ' || p_anio); END IF;
    RETURN fn_crear_asiento(make_date(p_anio, 12, 31), 'Cierre del ejercicio ' || p_anio || ': ingresos y gastos a resultados acumulados', 'CIERRE', p_anio, lineas, p_usuario_id);
END $$;

-- ---------------------------------------------------------------------------
--  6. AJUSTE POR DIFERENCIAL CAMBIARIO DEL INVENTARIO
-- ---------------------------------------------------------------------------
--  Compara el inventario valorado en Bs a la tasa del día de cierre (libro de inventario) con el saldo contable de «Inventario de mercancía».
--  Positivo → Debe Inventario / Haber Diferencial cambiario. Negativo → al revés. Un ajuste por mes.
--  OJO: si empezaste la contabilidad con mercancía ya en el estante, carga primero el asiento de apertura; si no, la diferencia saldrá enorme.
CREATE OR REPLACE FUNCTION fn_ajuste_cambiario_calculo(p_hasta date)
RETURNS TABLE (valor_fisico_ves numeric, saldo_contable_ves numeric, diferencia_ves numeric, valor_usd numeric, tasa numeric)
LANGUAGE sql STABLE AS $$
    WITH f AS (SELECT valor_ves, valor_usd FROM fn_libro_inventario(p_hasta) WHERE es_total),
         c AS (SELECT COALESCE(sum(d.debe - d.haber), 0) AS saldo FROM asiento_detalle d JOIN asientos a ON a.id = d.asiento_id
                WHERE d.cuenta_id = fn_cuenta_param('INVENTARIO') AND a.fecha <= p_hasta)
    SELECT COALESCE(f.valor_ves, 0), c.saldo, COALESCE(f.valor_ves, 0) - c.saldo, COALESCE(f.valor_usd, 0),
           CASE WHEN COALESCE(f.valor_usd, 0) > 0 THEN ROUND(f.valor_ves / f.valor_usd, 4) END
      FROM c LEFT JOIN f ON true
$$;

CREATE OR REPLACE FUNCTION fn_ajuste_cambiario(p_hasta date, p_usuario_id bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE r record; lineas jsonb; dif numeric; clave bigint := to_char(p_hasta, 'YYYYMM')::bigint;
BEGIN
    IF p_hasta > fn_hoy() THEN RAISE EXCEPTION 'La fecha del ajuste no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF EXISTS (SELECT 1 FROM asientos WHERE origen_tipo = 'AJUSTE_CAMBIARIO' AND origen_id = clave) THEN
        RAISE EXCEPTION 'Ya registraste el ajuste cambiario de %', to_char(p_hasta, 'MM/YYYY') USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO r FROM fn_ajuste_cambiario_calculo(p_hasta);
    IF r.valor_fisico_ves = 0 THEN RAISE EXCEPTION 'No hay inventario valorado a esa fecha: revisa que exista la tasa del día' USING ERRCODE = 'TV002'; END IF;
    dif := ROUND(r.diferencia_ves, 2);
    IF dif = 0 THEN RAISE EXCEPTION 'No hay diferencia que ajustar: el inventario contable ya coincide' USING ERRCODE = 'TV006'; END IF;
    lineas := CASE WHEN dif > 0
        THEN jsonb_build_array(jsonb_build_object('cuenta_id', fn_cuenta_param('INVENTARIO'), 'debe', dif, 'glosa', 'Actualización del inventario a la tasa del cierre'),
                               jsonb_build_object('cuenta_id', fn_cuenta_param('DIFERENCIAL_CAMBIARIO'), 'haber', dif, 'glosa', 'Diferencial cambiario del inventario (ganancia)'))
        ELSE jsonb_build_array(jsonb_build_object('cuenta_id', fn_cuenta_param('DIFERENCIAL_CAMBIARIO'), 'debe', -dif, 'glosa', 'Diferencial cambiario del inventario (pérdida)'),
                               jsonb_build_object('cuenta_id', fn_cuenta_param('INVENTARIO'), 'haber', -dif, 'glosa', 'Actualización del inventario a la tasa del cierre')) END;
    RETURN fn_crear_asiento(p_hasta, 'Ajuste por diferencial cambiario del inventario al ' || to_char(p_hasta, 'DD/MM/YYYY') || ' (tasa ' || COALESCE(r.tasa::text, '—') || ')', 'AJUSTE_CAMBIARIO', clave, lineas, p_usuario_id);
END $$;
