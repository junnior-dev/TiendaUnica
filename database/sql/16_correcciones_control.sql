-- =============================================================================
--  16 · Correcciones de control: IGTF en cobros, notas de crédito sobre la deuda, efectivo y turnos
-- =============================================================================
--  Requiere: 10, 14 y 15 (y el 11 y 12 si los usas). Es idempotente.
--     psql -d tienda -v ON_ERROR_STOP=1 -f 16_correcciones_control.sql
--
--  Qué corrige
--   1. IGTF en los cobros posteriores de una cuenta por cobrar. Un cobro en divisas (método con aplica_igtf) genera IGTF
--      sobre lo cobrado, con la alícuota vigente en la fecha del cobro. Queda en el asiento (IGTF por pagar), en
--      v_igtf_a_declarar (y con ello en Libros fiscales, Resumen quincenal y Conciliación) y en el ingreso de caja.
--   2. Notas de crédito sobre ventas a crédito: bajan la cuenta por cobrar (hasta su saldo). Solo el excedente sale como
--      devolución en dinero. El asiento acredita 1.1.06 por lo aplicado, no Caja/Bancos.
--   3. Cobros y anulaciones de cobros en efectivo EXIGEN turno abierto (ese dinero debe caer en un Corte Z).
--   4. fn_registrar_venta exige turno abierto en la base de datos (apagable en caja_config.exige_turno).
--   5. «Efectivo» deja de deducirse de «sin referencia»: metodos_pago.es_efectivo es un campo explícito. Los cobros eligen
--      un método de pago (ya no solo moneda + referencia).
--
--  Pendiente de confirmar con el contador (no verificado con fuente oficial):
--   · Que el IGTF se cause al cobrar en divisas una factura a crédito (así lo implementa este archivo).
--   · Si por esos cobros hay que emitir un comprobante aparte. Aquí no se emite: solo queda registrado y declarado.
--   · El 3 % de IGTF lo toma de la alícuota configurada (parametros_fiscales), no está fijo en el código.
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  A. metodos_pago.es_efectivo
-- ---------------------------------------------------------------------------
ALTER TABLE metodos_pago ADD COLUMN IF NOT EXISTS es_efectivo boolean;
UPDATE metodos_pago SET es_efectivo = NOT requiere_referencia WHERE es_efectivo IS NULL;
CREATE OR REPLACE FUNCTION trg_metodo_es_efectivo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.es_efectivo IS NULL THEN NEW.es_efectivo := NOT NEW.requiere_referencia; END IF;   -- método nuevo sin indicar: se deduce una sola vez
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_metodo_es_efectivo ON metodos_pago;
CREATE TRIGGER trg_metodo_es_efectivo BEFORE INSERT OR UPDATE ON metodos_pago FOR EACH ROW EXECUTE FUNCTION trg_metodo_es_efectivo();
ALTER TABLE metodos_pago ALTER COLUMN es_efectivo SET NOT NULL;
ALTER TABLE metodos_pago DROP CONSTRAINT IF EXISTS ck_efectivo_sin_referencia;
ALTER TABLE metodos_pago ADD CONSTRAINT ck_efectivo_sin_referencia CHECK (NOT (es_efectivo AND requiere_referencia));
COMMENT ON COLUMN metodos_pago.es_efectivo IS 'TRUE si es dinero físico que entra a la gaveta (cuenta en el arqueo y exige turno abierto). Lo define el administrador; ya no se deduce de si pide referencia. Un efectivo no puede pedir referencia.';

-- ---------------------------------------------------------------------------
--  B. Turno obligatorio (interruptor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caja_config (
    id           smallint PRIMARY KEY CHECK (id = 1),
    exige_turno  boolean NOT NULL DEFAULT true
);
INSERT INTO caja_config (id, exige_turno) VALUES (1, true) ON CONFLICT (id) DO NOTHING;
COMMENT ON TABLE caja_config IS 'Reglas de caja. exige_turno = TRUE: fn_registrar_venta rechaza ventas de un usuario sin turno abierto. Para cargas históricas: UPDATE caja_config SET exige_turno = false (y vuélvelo a activar).';

-- ---------------------------------------------------------------------------
--  C. Cobros: método de pago e IGTF
-- ---------------------------------------------------------------------------
ALTER TABLE pagos_cobrar ADD COLUMN IF NOT EXISTS metodo_pago_id bigint REFERENCES metodos_pago(id);
ALTER TABLE pagos_cobrar ADD COLUMN IF NOT EXISTS aplica_igtf boolean       NOT NULL DEFAULT false;
ALTER TABLE pagos_cobrar ADD COLUMN IF NOT EXISTS igtf_monto  numeric(18,2) NOT NULL DEFAULT 0 CHECK (igtf_monto >= 0);
ALTER TABLE pagos_cobrar ADD COLUMN IF NOT EXISTS igtf_usd    numeric(18,2) NOT NULL DEFAULT 0 CHECK (igtf_usd >= 0);
ALTER TABLE pagos_cobrar ADD COLUMN IF NOT EXISTS igtf_ves    numeric(18,2) NOT NULL DEFAULT 0 CHECK (igtf_ves >= 0);
COMMENT ON COLUMN pagos_cobrar.metodo_pago_id IS 'Método con el que se cobró (NULL en cobros anteriores al 16, que se trataban como efectivo si no tenían referencia).';
COMMENT ON COLUMN pagos_cobrar.igtf_monto IS 'IGTF de este cobro en la moneda del cobro. El cliente entrega monto + igtf_monto.';
COMMENT ON COLUMN pagos_cobrar.igtf_usd IS 'IGTF del cobro en USD (alícuota vigente en la fecha del cobro).';
COMMENT ON COLUMN pagos_cobrar.igtf_ves IS 'IGTF del cobro en Bs, a la tasa implícita del cobro (monto_ves / monto_usd).';

-- ---------------------------------------------------------------------------
--  D. Notas de crédito aplicadas a la deuda (inmutable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notas_cxc_aplicacion (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nota_id               bigint        NOT NULL UNIQUE REFERENCES notas_ajuste(id),
    cuenta_por_cobrar_id  bigint        NOT NULL REFERENCES cuentas_por_cobrar(id),
    monto_usd             numeric(18,2) NOT NULL CHECK (monto_usd >= 0),
    monto_ves             numeric(18,2) NOT NULL CHECK (monto_ves > 0),
    created_at            timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_notas_cxc_cuenta ON notas_cxc_aplicacion (cuenta_por_cobrar_id);
DROP TRIGGER IF EXISTS trg_notas_cxc_inmutable ON notas_cxc_aplicacion;
CREATE TRIGGER trg_notas_cxc_inmutable BEFORE UPDATE OR DELETE ON notas_cxc_aplicacion FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();
COMMENT ON TABLE notas_cxc_aplicacion IS 'Cuánto de una nota de crédito bajó la cuenta por cobrar de una venta a crédito. Lo que la nota exceda del saldo se devuelve en dinero.';

-- ---- Cuenta contable de cada método: ahora manda es_efectivo (antes: «sin referencia»)
CREATE OR REPLACE FUNCTION fn_cuenta_pago_venta(p_venta_id bigint) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE c bigint;
BEGIN
    SELECT COALESCE(mc.cuenta_id, CASE WHEN m.es_efectivo THEN fn_cuenta_param('CAJA') ELSE fn_cuenta_param('BANCOS') END)
      INTO c
      FROM pagos_venta pv JOIN metodos_pago m ON m.id = pv.metodo_pago_id LEFT JOIN contab_metodo_cuenta mc ON mc.metodo_pago_id = m.id
     WHERE pv.venta_id = p_venta_id
     ORDER BY pv.monto_ves DESC, pv.id LIMIT 1;
    RETURN COALESCE(c, fn_cuenta_param('CAJA'));
END $$;

-- ---- Asiento de la venta (igual al del 15; solo cambia la cuenta por defecto del método)
CREATE OR REPLACE FUNCTION fn_asiento_venta(p_venta_id bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v ventas; lineas jsonb := '[]'::jsonb; p record; cobrado numeric := 0; ventas_bs numeric; igtf numeric; costo numeric; dif numeric; cxc numeric := 0;
BEGIN
    SELECT * INTO v FROM ventas WHERE id = p_venta_id;
    FOR p IN SELECT COALESCE(mc.cuenta_id, CASE WHEN m.es_efectivo THEN fn_cuenta_param('CAJA') ELSE fn_cuenta_param('BANCOS') END) AS cuenta_id,
                    sum(pv.monto_ves + COALESCE(pv.igtf_ves, 0)) AS monto
               FROM pagos_venta pv JOIN metodos_pago m ON m.id = pv.metodo_pago_id LEFT JOIN contab_metodo_cuenta mc ON mc.metodo_pago_id = m.id
              WHERE pv.venta_id = p_venta_id GROUP BY 1 ORDER BY 1 LOOP
        lineas := lineas || jsonb_build_object('cuenta_id', p.cuenta_id, 'debe', p.monto, 'glosa', 'Cobro de la venta ' || v.numero);
        cobrado := cobrado + p.monto;
    END LOOP;
    SELECT COALESCE(sum(monto_original_ves), 0) INTO cxc FROM cuentas_por_cobrar WHERE venta_id = p_venta_id;
    IF cxc > 0 THEN
        lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('CUENTAS_POR_COBRAR'), 'debe', cxc, 'glosa', 'Venta a crédito ' || v.numero);
    END IF;
    ventas_bs := v.base_ves + v.exento_ves;
    igtf := COALESCE((SELECT sum(igtf_ves) FROM pagos_venta WHERE venta_id = p_venta_id), 0);
    lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('VENTAS'), 'haber', ventas_bs, 'glosa', 'Venta sin IVA');
    IF v.iva_ves > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('IVA_DEBITO'), 'haber', v.iva_ves, 'glosa', 'IVA de la venta'); END IF;
    IF igtf > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('IGTF_POR_PAGAR'), 'haber', igtf, 'glosa', 'IGTF percibido en divisas'); END IF;
    dif := cobrado + cxc - (ventas_bs + v.iva_ves + igtf);
    IF dif > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('REDONDEO'), 'haber', dif, 'glosa', 'Diferencia por redondeo');
    ELSIF dif < 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('REDONDEO'), 'debe', -dif, 'glosa', 'Diferencia por redondeo'); END IF;
    costo := ROUND(COALESCE((SELECT sum(ROUND(cantidad * costo_unitario_usd, 2)) FROM detalle_venta WHERE venta_id = p_venta_id), 0) * v.tasa_cambio, 2);
    IF costo > 0 THEN
        lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('COSTO_VENTAS'), 'debe', costo, 'glosa', 'Costo de la mercancía vendida')
                         || jsonb_build_object('cuenta_id', fn_cuenta_param('INVENTARIO'), 'haber', costo, 'glosa', 'Salida de inventario');
    END IF;
    RETURN fn_crear_asiento(v.fecha_valor, 'Venta ' || v.numero, 'VENTA', p_venta_id, lineas, v.usuario_id);
END $$;

-- ---- Contra-asiento: el IGTF de un cobro anulado también pasa a «IGTF por reclamar», igual que el de una venta anulada
CREATE OR REPLACE FUNCTION fn_contra_asiento(p_origen_tipo text, p_origen_id bigint, p_nuevo_tipo text, p_fecha date, p_concepto text, p_usuario_id bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE a asientos; lineas jsonb; igtf_pagar bigint;
BEGIN
    SELECT * INTO a FROM asientos WHERE origen_tipo = p_origen_tipo AND origen_id = p_origen_id;
    IF a.id IS NULL THEN RETURN NULL; END IF;     -- el documento es anterior a la contabilidad automática: no hay nada que revertir
    SELECT cuenta_id INTO igtf_pagar FROM contab_parametros WHERE clave = 'IGTF_POR_PAGAR';
    SELECT jsonb_agg(jsonb_build_object(
               'cuenta_id', CASE WHEN p_origen_tipo IN ('VENTA','COBRO_CLIENTE') AND d.cuenta_id = igtf_pagar THEN fn_cuenta_param('IGTF_POR_RECLAMAR') ELSE d.cuenta_id END,
               'debe', d.haber, 'haber', d.debe, 'glosa', 'Reverso: ' || COALESCE(d.glosa, '')) ORDER BY d.id)
      INTO lineas FROM asiento_detalle d WHERE d.asiento_id = a.id;
    RETURN fn_crear_asiento(p_fecha, p_concepto, p_nuevo_tipo, p_origen_id, lineas, p_usuario_id);
END $$;

-- ---- Resumen del turno (igual al del 15; «efectivo» = metodos_pago.es_efectivo)
CREATE OR REPLACE FUNCTION fn_resumen_apertura(p_apertura_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE a aperturas_caja; hasta timestamptz; vids bigint[]; r jsonb; metodos jsonb; ingresos jsonb; egresos jsonb; monedas jsonb; res record;
BEGIN
    SELECT * INTO a FROM aperturas_caja WHERE id = p_apertura_id;
    IF a.id IS NULL THEN RAISE EXCEPTION 'El turno de caja no existe' USING ERRCODE = 'TV006'; END IF;
    hasta := COALESCE(a.fecha_cierre, clock_timestamp());

    SELECT COALESCE(array_agg(v.id), '{}') INTO vids FROM ventas v
     WHERE v.usuario_id = a.usuario_id AND v.estado = 'COMPLETADA' AND v.fecha_hora >= a.fecha_apertura AND v.fecha_hora <= hasta;

    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY array_position(ARRAY['USD','EUR','COP','VES'], x.moneda), x.metodo), '[]'::jsonb) INTO metodos FROM (
        SELECT mp.nombre AS metodo, trim(pv.moneda) AS moneda, mp.es_efectivo AS efectivo, count(*) AS n,
               sum(pv.monto_cobrado) AS cobrado, sum(pv.monto_usd + COALESCE(pv.igtf_usd, 0)) AS usd, sum(pv.monto_ves + COALESCE(pv.igtf_ves, 0)) AS ves,
               sum(COALESCE(pv.monto_entregado, pv.monto_cobrado)) AS recibido, COALESCE(sum(pv.igtf_usd), 0) AS igtf_usd, COALESCE(sum(pv.igtf_ves), 0) AS igtf_ves
          FROM pagos_venta pv JOIN ventas t ON t.id = pv.venta_id AND t.id = ANY(vids) JOIN metodos_pago mp ON mp.id = pv.metodo_pago_id
         GROUP BY mp.id, mp.nombre, pv.moneda, mp.es_efectivo) x;

    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) INTO ingresos FROM (
        SELECT id, concepto, trim(moneda) AS moneda, monto, monto_usd, monto_ves, es_efectivo, origen, to_char(created_at AT TIME ZONE 'America/Caracas', 'HH24:MI') AS hora
          FROM movimientos_caja WHERE apertura_id = a.id AND tipo = 'INGRESO' AND estado = 'ACTIVO') x;
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::jsonb) INTO egresos FROM (
        SELECT id, concepto, trim(moneda) AS moneda, monto, monto_usd, monto_ves, es_efectivo, origen, to_char(created_at AT TIME ZONE 'America/Caracas', 'HH24:MI') AS hora
          FROM movimientos_caja WHERE apertura_id = a.id AND tipo = 'EGRESO' AND estado = 'ACTIVO') x;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'moneda', m.moneda, 'fondo', m.fondo, 'efectivo_recibido', m.recibido, 'vuelto', m.vuelto,
               'ingresos', m.ing, 'egresos', m.egr, 'esperado', ROUND(m.fondo + m.recibido - m.vuelto + m.ing - m.egr, 2))
           ORDER BY array_position(ARRAY['USD','EUR','COP','VES'], m.moneda)), '[]'::jsonb) INTO monedas FROM (
        SELECT mo.moneda,
               CASE mo.moneda WHEN 'USD' THEN a.fondo_inicial_usd WHEN 'VES' THEN a.fondo_inicial_ves ELSE 0 END AS fondo,
               COALESCE((SELECT sum(COALESCE(pv.monto_entregado, pv.monto_cobrado)) FROM pagos_venta pv JOIN ventas t ON t.id = pv.venta_id AND t.id = ANY(vids) JOIN metodos_pago mp ON mp.id = pv.metodo_pago_id
                          WHERE mp.es_efectivo AND trim(pv.moneda) = mo.moneda), 0) AS recibido,
               COALESCE((SELECT sum(pv.vuelto_monto) FROM pagos_venta pv JOIN ventas t ON t.id = pv.venta_id AND t.id = ANY(vids) WHERE trim(pv.vuelto_moneda) = mo.moneda AND pv.vuelto_monto > 0), 0) AS vuelto,
               COALESCE((SELECT sum(monto) FROM movimientos_caja WHERE apertura_id = a.id AND tipo = 'INGRESO' AND estado = 'ACTIVO' AND es_efectivo AND trim(moneda) = mo.moneda), 0) AS ing,
               COALESCE((SELECT sum(monto) FROM movimientos_caja WHERE apertura_id = a.id AND tipo = 'EGRESO' AND estado = 'ACTIVO' AND es_efectivo AND trim(moneda) = mo.moneda), 0) AS egr
          FROM (SELECT trim(codigo) AS moneda FROM monedas WHERE trim(codigo) IN ('USD','VES')
                UNION SELECT trim(pv.moneda) FROM pagos_venta pv JOIN ventas t ON t.id = pv.venta_id AND t.id = ANY(vids)
                UNION SELECT trim(pv.vuelto_moneda) FROM pagos_venta pv JOIN ventas t ON t.id = pv.venta_id AND t.id = ANY(vids) WHERE pv.vuelto_monto > 0
                UNION SELECT trim(moneda) FROM movimientos_caja WHERE apertura_id = a.id AND estado = 'ACTIVO') mo) m;

    SELECT count(*) AS ventas, count(*) FILTER (WHERE v.es_credito) AS credito,
           COALESCE(sum(v.total_usd), 0) AS vendido_usd, COALESCE(sum(v.saldo_pendiente_usd) FILTER (WHERE v.es_credito), 0) AS a_credito_usd,
           COALESCE(sum(v.igtf_usd), 0) AS igtf_usd, COALESCE(sum(v.igtf_ves), 0) AS igtf_ves
      INTO res FROM ventas v WHERE v.id = ANY(vids);

    r := jsonb_build_object(
        'apertura', jsonb_build_object('id', a.id, 'usuario_id', a.usuario_id, 'cajero', (SELECT nombre_completo FROM usuarios WHERE id = a.usuario_id),
            'estado', a.estado, 'fecha_apertura', a.fecha_apertura, 'fecha_cierre', a.fecha_cierre,
            'fondo_usd', a.fondo_inicial_usd, 'fondo_ves', a.fondo_inicial_ves),
        'ventas', res.ventas, 'ventas_credito', res.credito, 'vendido_usd', res.vendido_usd, 'a_credito_usd', res.a_credito_usd,
        'igtf_usd', res.igtf_usd, 'igtf_ves', res.igtf_ves,
        'total_usd', COALESCE((SELECT sum((m->>'usd')::numeric) FROM jsonb_array_elements(metodos) m), 0),
        'total_ves', COALESCE((SELECT sum((m->>'ves')::numeric) FROM jsonb_array_elements(metodos) m), 0),
        'metodos', metodos, 'ingresos', ingresos, 'egresos', egresos, 'monedas', monedas);
    RETURN r;
END $$;

-- ---- Registro de venta (igual al del 15 + exige turno abierto)
CREATE OR REPLACE FUNCTION fn_registrar_venta(
    p_usuario_id bigint, p_items jsonb, p_pagos jsonb, p_cliente_id bigint DEFAULT NULL, p_observaciones text DEFAULT NULL,
    p_tipo_emision text DEFAULT 'PRESENCIAL', p_es_credito boolean DEFAULT false, p_dias_credito integer DEFAULT 30)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_id bigint; it record; pg record; v ventas; pagado numeric; tol numeric; falta_usd numeric; falta_ves numeric;
BEGIN
    p_es_credito := COALESCE(p_es_credito, false);
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Agregue al menos un producto' USING ERRCODE = 'TV006';
    END IF;
    IF p_es_credito THEN
        IF p_cliente_id IS NULL THEN RAISE EXCEPTION 'Una venta a crédito necesita un cliente (no vale «consumidor final»)' USING ERRCODE = 'TV006'; END IF;
        IF NOT EXISTS (SELECT 1 FROM clientes WHERE id = p_cliente_id AND activo) THEN RAISE EXCEPTION 'El cliente no existe o está inactivo' USING ERRCODE = 'TV006'; END IF;
        IF p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array' THEN p_pagos := '[]'::jsonb; END IF;
        IF COALESCE(p_dias_credito, 30) < 0 OR COALESCE(p_dias_credito, 30) > 365 THEN RAISE EXCEPTION 'Los días de crédito deben estar entre 0 y 365' USING ERRCODE = 'TV006'; END IF;
    ELSIF p_pagos IS NULL OR jsonb_typeof(p_pagos) <> 'array' OR jsonb_array_length(p_pagos) = 0 THEN
        RAISE EXCEPTION 'Indique al menos un pago' USING ERRCODE = 'TV006';
    END IF;
    -- Turno obligatorio también en la base (no solo en el controlador): ninguna otra vía puede vender sin caja abierta.
    IF COALESCE((SELECT exige_turno FROM caja_config WHERE id = fn_negocio_actual()), true) AND fn_apertura_activa(p_usuario_id) IS NULL THEN
        RAISE EXCEPTION 'Abre tu caja antes de vender: no hay un turno abierto para este usuario' USING ERRCODE = 'TV005';
    END IF;
    PERFORM set_config('tienda.usuario_id', COALESCE(p_usuario_id::text, ''), true);
    PERFORM 1 FROM productos WHERE id IN (SELECT producto_id FROM jsonb_to_recordset(p_items) AS x(producto_id bigint)) ORDER BY id FOR UPDATE;

    INSERT INTO ventas (usuario_id, cliente_id, observaciones, tipo_emision, es_credito)
    VALUES (p_usuario_id, p_cliente_id, p_observaciones, COALESCE(p_tipo_emision, 'PRESENCIAL'), p_es_credito) RETURNING id INTO v_id;

    FOR it IN SELECT * FROM jsonb_to_recordset(p_items) AS x(producto_id bigint, cantidad numeric, descuento_pct numeric) LOOP
        INSERT INTO detalle_venta (venta_id, producto_id, cantidad, descuento_pct)
        VALUES (v_id, it.producto_id, it.cantidad, COALESCE(it.descuento_pct, 0));
    END LOOP;

    FOR pg IN SELECT * FROM jsonb_to_recordset(p_pagos) AS x(metodo_pago_id bigint, monto numeric, referencia text, monto_entregado numeric, vuelto_monto numeric, vuelto_moneda text) LOOP
        INSERT INTO pagos_venta (venta_id, metodo_pago_id, monto, referencia, monto_entregado, vuelto_monto, vuelto_moneda)
        VALUES (v_id, pg.metodo_pago_id, pg.monto, pg.referencia, pg.monto_entregado, pg.vuelto_monto, pg.vuelto_moneda);
    END LOOP;

    IF p_es_credito THEN
        SELECT * INTO v FROM ventas WHERE id = v_id;
        SELECT COALESCE(sum(monto_usd), 0) INTO pagado FROM pagos_venta WHERE venta_id = v_id;
        SELECT COALESCE(tolerancia_pago_usd, 0.01) INTO tol FROM negocio WHERE id = fn_negocio_actual();
        falta_usd := v.total_usd - pagado;
        IF pagado > v.total_usd + tol THEN
            RAISE EXCEPTION 'Los pagos (USD %) superan el total de la venta (USD %)', pagado, v.total_usd USING ERRCODE = 'TV004';
        ELSIF falta_usd > tol THEN
            falta_ves := GREATEST(ROUND(v.total_ves - COALESCE((SELECT sum(monto_ves) FROM pagos_venta WHERE venta_id = v_id), 0), 2), 0);
            INSERT INTO cuentas_por_cobrar (cliente_id, venta_id, monto_original_usd, monto_original_ves, saldo_usd, saldo_ves, fecha_vencimiento)
            VALUES (p_cliente_id, v_id, falta_usd, falta_ves, falta_usd, falta_ves, v.fecha_valor + COALESCE(p_dias_credito, 30));
        ELSE
            -- Pagó todo: no hay deuda, la venta queda como venta de contado.
            UPDATE ventas SET es_credito = false WHERE id = v_id;
        END IF;
    END IF;

    PERFORM fn_validar_pagos_venta(v_id);
    RETURN v_id;
END $$;

-- ---- Guardia de inmutabilidad (igual a la del 15; protege también los campos de IGTF y el método)
CREATE OR REPLACE FUNCTION trg_cobros_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n record;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'No se puede borrar un registro de %: anúlelo', TG_TABLE_NAME USING ERRCODE = 'TV005'; END IF;
    IF OLD.estado <> 'ACTIVO' OR NEW.estado <> 'ANULADO' THEN RAISE EXCEPTION 'Un registro de % solo puede pasar de ACTIVO a ANULADO', TG_TABLE_NAME USING ERRCODE = 'TV005'; END IF;
    IF TG_TABLE_NAME = 'pagos_cobrar' THEN
        IF (NEW.cuenta_por_cobrar_id, NEW.fecha, NEW.moneda, NEW.monto, NEW.monto_usd, NEW.monto_ves, NEW.aplicado_ves, NEW.usuario_id, NEW.igtf_monto, NEW.igtf_usd, NEW.igtf_ves, NEW.metodo_pago_id)
           IS DISTINCT FROM (OLD.cuenta_por_cobrar_id, OLD.fecha, OLD.moneda, OLD.monto, OLD.monto_usd, OLD.monto_ves, OLD.aplicado_ves, OLD.usuario_id, OLD.igtf_monto, OLD.igtf_usd, OLD.igtf_ves, OLD.metodo_pago_id) THEN
            RAISE EXCEPTION 'Del cobro solo se puede registrar la anulación' USING ERRCODE = 'TV005'; END IF;
    ELSE
        IF (NEW.apertura_id, NEW.tipo, NEW.concepto, NEW.monto, NEW.moneda, NEW.monto_usd, NEW.monto_ves, NEW.usuario_id)
           IS DISTINCT FROM (OLD.apertura_id, OLD.tipo, OLD.concepto, OLD.monto, OLD.moneda, OLD.monto_usd, OLD.monto_ves, OLD.usuario_id) THEN
            RAISE EXCEPTION 'Del movimiento solo se puede registrar la anulación' USING ERRCODE = 'TV005'; END IF;
    END IF;
    RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
--  E. Cobro de una cuenta por cobrar (método, efectivo con turno, IGTF)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_registrar_pago_cobrar(bigint, date, bpchar, numeric, text, bigint);
CREATE OR REPLACE FUNCTION fn_registrar_pago_cobrar(
    p_cuenta_id bigint, p_fecha date, p_moneda char(3), p_monto numeric, p_referencia text, p_usuario_id bigint, p_metodo_pago_id bigint)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    c cuentas_por_cobrar; vta ventas; neg negocio; m metodos_pago;
    v_id bigint; mon char(3); t_usd numeric; t_ves numeric; m_usd numeric; m_ves numeric; aplicado numeric; efectivo boolean;
    nuevo_usd numeric; nuevo_ves numeric; num bigint; nombre text; dif numeric; lineas jsonb; cta bigint;
    aplica boolean := false; pct numeric := 0; i_usd numeric := 0; i_ves numeric := 0; i_monto numeric := 0;
BEGIN
    IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto del cobro debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha IS NULL OR p_fecha > fn_hoy() THEN RAISE EXCEPTION 'La fecha del cobro no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF p_metodo_pago_id IS NULL THEN RAISE EXCEPTION 'Elige el método con el que te pagó el cliente' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO m FROM metodos_pago WHERE id = p_metodo_pago_id;
    IF m.id IS NULL OR NOT m.activo THEN RAISE EXCEPTION 'El método de cobro no existe o está inactivo' USING ERRCODE = 'TV006'; END IF;
    mon := m.moneda;
    IF p_moneda IS NOT NULL AND trim(p_moneda) <> trim(mon) THEN
        RAISE EXCEPTION 'El método "%" cobra en %, no en %', m.nombre, trim(mon), trim(p_moneda) USING ERRCODE = 'TV006';
    END IF;
    IF m.requiere_referencia AND NULLIF(trim(COALESCE(p_referencia, '')), '') IS NULL THEN
        RAISE EXCEPTION 'El método "%" requiere número de referencia', m.nombre USING ERRCODE = 'TV006';
    END IF;
    efectivo := m.es_efectivo;

    PERFORM pg_advisory_xact_lock(hashtext('tienda.cxc.' || p_cuenta_id));
    SELECT * INTO c FROM cuentas_por_cobrar WHERE id = p_cuenta_id FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'La cuenta por cobrar no existe' USING ERRCODE = 'TV006'; END IF;
    IF c.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'Esta cuenta ya está %', lower(c.estado) USING ERRCODE = 'TV006'; END IF;
    IF p_fecha < (c.created_at AT TIME ZONE 'America/Caracas')::date THEN RAISE EXCEPTION 'La fecha del cobro no puede ser anterior a la venta' USING ERRCODE = 'TV006'; END IF;
    IF fn_periodo_cerrado(p_fecha) THEN RAISE EXCEPTION 'La fecha del cobro cae en un período contable cerrado (%)', to_char(p_fecha, 'MM/YYYY') USING ERRCODE = 'TV005'; END IF;

    -- El efectivo físico debe entrar a un turno: si no, queda fuera de todo arqueo y el Corte Z no se explica.
    IF efectivo AND fn_apertura_activa(p_usuario_id) IS NULL THEN
        RAISE EXCEPTION 'Para cobrar en efectivo abre tu caja: ese dinero debe entrar a un turno y a su Corte Z. Si fue transferencia o pago móvil, elige ese método.' USING ERRCODE = 'TV005';
    END IF;

    t_usd := CASE WHEN mon = 'USD' THEN 1 ELSE fn_tasa_par(mon, 'USD', p_fecha) END;
    t_ves := CASE WHEN mon = 'VES' THEN 1 ELSE fn_tasa_par(mon, 'VES', p_fecha) END;
    m_usd := ROUND(p_monto * t_usd, 2);  m_ves := ROUND(p_monto * t_ves, 2);
    IF m_usd <= 0 OR m_ves <= 0 THEN RAISE EXCEPTION 'El monto es demasiado pequeño' USING ERRCODE = 'TV006'; END IF;
    IF m_usd > c.saldo_usd + 0.01 THEN
        RAISE EXCEPTION 'El cobro (US$ %) es mayor que el saldo pendiente (US$ %)', to_char(m_usd, 'FM999G999G990D00'), to_char(c.saldo_usd, 'FM999G999G990D00') USING ERRCODE = 'TV006';
    END IF;
    IF m_usd > c.saldo_usd THEN m_usd := c.saldo_usd; END IF;

    nuevo_usd := c.saldo_usd - m_usd;
    aplicado := CASE WHEN nuevo_usd = 0 THEN c.saldo_ves ELSE LEAST(ROUND(m_usd * c.monto_original_ves / c.monto_original_usd, 2), c.saldo_ves) END;
    nuevo_ves := c.saldo_ves - aplicado;

    -- IGTF del cobro: solo si el negocio lo cobra y el método es una divisa sin banca venezolana (metodos_pago.aplica_igtf).
    -- Se causa al recibir la divisa, así que usa la alícuota de la fecha del cobro (no la de la venta). Base: la de la venta si existe.
    SELECT * INTO neg FROM negocio WHERE id = fn_negocio_actual();
    IF c.venta_id IS NOT NULL THEN SELECT * INTO vta FROM ventas WHERE id = c.venta_id; END IF;
    aplica := COALESCE(neg.cobra_igtf, false) AND m.aplica_igtf;
    IF aplica THEN
        pct := COALESCE(fn_igtf_pct(p_fecha), 0);
        i_usd := fn_igtf_usd(m_usd, vta.total_usd, vta.iva_usd, COALESCE(vta.igtf_base, neg.igtf_base), pct);
        i_ves := ROUND(i_usd * m_ves / m_usd, 2);
        i_monto := ROUND(i_usd / t_usd, 2);
        IF i_usd <= 0 THEN aplica := false; i_usd := 0; i_ves := 0; i_monto := 0; END IF;
    END IF;

    INSERT INTO pagos_cobrar (cuenta_por_cobrar_id, fecha, moneda, monto, tasa_usd, tasa_ves, monto_usd, monto_ves, aplicado_ves, es_efectivo, referencia, usuario_id,
                              metodo_pago_id, aplica_igtf, igtf_monto, igtf_usd, igtf_ves)
    VALUES (c.id, p_fecha, mon, ROUND(p_monto, 2), t_usd, t_ves, m_usd, m_ves, aplicado, efectivo, NULLIF(trim(p_referencia), ''), p_usuario_id,
            m.id, aplica, i_monto, i_usd, i_ves)
    RETURNING id INTO v_id;

    UPDATE cuentas_por_cobrar SET saldo_usd = nuevo_usd, saldo_ves = nuevo_ves, estado = CASE WHEN nuevo_usd = 0 THEN 'PAGADA' ELSE 'PENDIENTE' END WHERE id = c.id;

    SELECT ve.numero, cl.nombre INTO num, nombre FROM clientes cl LEFT JOIN ventas ve ON ve.id = c.venta_id WHERE cl.id = c.cliente_id;
    -- En la caja entra todo lo que el cliente entrega: lo cobrado + su IGTF.
    PERFORM fn_registrar_movimiento_caja(p_usuario_id, 'INGRESO',
            'Cobro cuenta por cobrar' || COALESCE(' · venta ' || num, '') || ' · ' || nombre || CASE WHEN i_monto > 0 THEN ' (incluye IGTF)' ELSE '' END,
            mon, ROUND(p_monto + i_monto, 2), p_referencia, 'COBRO_CXC', v_id, efectivo, efectivo);

    -- Asiento: Debe Caja/Bancos (cobro + IGTF) / Haber Cuentas por cobrar (Bs de la venta) / Haber IGTF por pagar; la diferencia es diferencial cambiario.
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false)
       AND (c.venta_id IS NULL OR EXISTS (SELECT 1 FROM asientos WHERE origen_tipo = 'VENTA' AND origen_id = c.venta_id)) AND aplicado > 0 THEN
        cta := COALESCE((SELECT cuenta_id FROM contab_metodo_cuenta WHERE metodo_pago_id = m.id), fn_cuenta_param(CASE WHEN efectivo THEN 'CAJA' ELSE 'BANCOS' END));
        lineas := jsonb_build_array(
            jsonb_build_object('cuenta_id', cta, 'debe', m_ves + i_ves, 'glosa', COALESCE('Ref. ' || NULLIF(trim(p_referencia), ''), 'Cobro a cliente')),
            jsonb_build_object('cuenta_id', fn_cuenta_param('CUENTAS_POR_COBRAR'), 'haber', aplicado, 'glosa', nombre));
        IF i_ves > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('IGTF_POR_PAGAR'), 'haber', i_ves, 'glosa', 'IGTF percibido en el cobro'); END IF;
        dif := aplicado - m_ves;      -- >0: se cobró menos Bs de los que se debían (pérdida); <0: ganancia
        IF dif > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('DIFERENCIAL_CAMBIARIO'), 'debe', dif, 'glosa', 'Diferencial cambiario (pérdida)');
        ELSIF dif < 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('DIFERENCIAL_CAMBIARIO'), 'haber', -dif, 'glosa', 'Diferencial cambiario (ganancia)'); END IF;
        PERFORM fn_crear_asiento(p_fecha, 'Cobro a cliente N.º ' || v_id, 'COBRO_CLIENTE', v_id, lineas, p_usuario_id);
    END IF;
    RETURN v_id;
END $$;
COMMENT ON FUNCTION fn_registrar_pago_cobrar(bigint, date, char, numeric, text, bigint, bigint) IS
    'Cobra una cuenta por cobrar con un método de pago. Efectivo exige turno abierto; si el método aplica IGTF y el negocio lo cobra, calcula el IGTF del cobro (alícuota de la fecha) y lo lleva a asiento, caja y v_igtf_a_declarar.';

CREATE OR REPLACE FUNCTION fn_anular_pago_cobrar(p_pago_id bigint, p_motivo text, p_usuario_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p pagos_cobrar; c cuentas_por_cobrar;
BEGIN
    SELECT * INTO p FROM pagos_cobrar WHERE id = p_pago_id FOR UPDATE;
    IF p.id IS NULL THEN RAISE EXCEPTION 'El cobro no existe' USING ERRCODE = 'TV006'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('tienda.cxc.' || p.cuenta_por_cobrar_id));
    SELECT * INTO c FROM cuentas_por_cobrar WHERE id = p.cuenta_por_cobrar_id FOR UPDATE;
    IF p.estado = 'ANULADO' THEN RAISE EXCEPTION 'Ese cobro ya está anulado' USING ERRCODE = 'TV006'; END IF;
    IF c.estado = 'ANULADA' THEN RAISE EXCEPTION 'La cuenta fue anulada con su venta' USING ERRCODE = 'TV005'; END IF;
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    IF fn_periodo_cerrado(p.fecha) THEN RAISE EXCEPTION 'El cobro es de un período contable cerrado (%): no se puede anular', to_char(p.fecha, 'MM/YYYY') USING ERRCODE = 'TV005'; END IF;
    -- Anular un cobro en efectivo devuelve dinero de la gaveta: tiene que quedar en el arqueo de un turno.
    IF p.es_efectivo AND fn_apertura_activa(p_usuario_id) IS NULL THEN
        RAISE EXCEPTION 'Para anular un cobro en efectivo abre tu caja: el dinero que se devuelve sale de ella y debe quedar en tu Corte Z' USING ERRCODE = 'TV005';
    END IF;

    UPDATE pagos_cobrar SET estado = 'ANULADO', anulado_en = now(), anulado_por = p_usuario_id, motivo_anulacion = trim(p_motivo) WHERE id = p.id;
    UPDATE cuentas_por_cobrar SET saldo_usd = saldo_usd + p.monto_usd, saldo_ves = saldo_ves + p.aplicado_ves, estado = 'PENDIENTE' WHERE id = c.id;
    PERFORM fn_registrar_movimiento_caja(p_usuario_id, 'EGRESO', 'Anulación de cobro N.º ' || p.id || ' · ' || trim(p_motivo), p.moneda, ROUND(p.monto + p.igtf_monto, 2), p.referencia,
            'ANULACION_COBRO', p.id, p.es_efectivo, p.es_efectivo);
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN
        PERFORM fn_contra_asiento('COBRO_CLIENTE', p.id, 'ANULACION_COBRO', fn_hoy(), 'Anulación del cobro N.º ' || p.id, p_usuario_id);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
--  F. Notas de crédito sobre ventas a crédito: bajan la cuenta por cobrar
-- ---------------------------------------------------------------------------
--  El nombre empieza por «trg_a_» a propósito: PostgreSQL dispara los triggers del mismo evento por orden alfabético y este
--  debe correr ANTES que trg_contab_nota_credito, que lee notas_cxc_aplicacion para armar el asiento.
CREATE OR REPLACE FUNCTION trg_a_nota_aplica_cxc() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c cuentas_por_cobrar; vta ventas; apl_ves numeric; apl_usd numeric; nuevo_usd numeric;
BEGIN
    SELECT * INTO c FROM cuentas_por_cobrar WHERE venta_id = NEW.venta_id AND estado = 'PENDIENTE' FOR UPDATE;
    IF c.id IS NULL THEN RETURN NULL; END IF;                         -- venta de contado, ya pagada o sin deuda: la nota sigue siendo una devolución en dinero
    SELECT * INTO vta FROM ventas WHERE id = NEW.venta_id;
    apl_ves := LEAST(NEW.total_ves, c.saldo_ves);
    IF apl_ves <= 0 THEN RETURN NULL; END IF;
    IF apl_ves >= c.saldo_ves THEN
        apl_ves := c.saldo_ves; apl_usd := c.saldo_usd;               -- liquida la deuda exacta
    ELSE
        apl_usd := ROUND(apl_ves / vta.tasa_cambio, 2);               -- la deuda en Bs está a la tasa de la venta
        IF apl_usd >= c.saldo_usd THEN apl_usd := c.saldo_usd; apl_ves := c.saldo_ves; END IF;
    END IF;
    nuevo_usd := c.saldo_usd - apl_usd;
    INSERT INTO notas_cxc_aplicacion (nota_id, cuenta_por_cobrar_id, monto_usd, monto_ves) VALUES (NEW.id, c.id, apl_usd, apl_ves);
    UPDATE cuentas_por_cobrar SET saldo_usd = nuevo_usd, saldo_ves = c.saldo_ves - apl_ves,
           estado = CASE WHEN nuevo_usd = 0 THEN 'PAGADA' ELSE 'PENDIENTE' END WHERE id = c.id;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_a_nota_aplica_cxc ON notas_ajuste;
CREATE TRIGGER trg_a_nota_aplica_cxc AFTER INSERT ON notas_ajuste FOR EACH ROW WHEN (NEW.tipo = 'C') EXECUTE FUNCTION trg_a_nota_aplica_cxc();

-- Asiento de la nota de crédito: Debe Ventas + IVA débito; Haber Cuentas por cobrar (lo aplicado a la deuda) y Caja/Bancos (solo el excedente devuelto).
CREATE OR REPLACE FUNCTION trg_contab_nota_credito() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lineas jsonb; v_numero text; apl numeric := 0;
BEGIN
    IF NEW.tipo <> 'C' OR NOT COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN RETURN NULL; END IF;
    SELECT numero INTO v_numero FROM ventas WHERE id = NEW.venta_id;
    SELECT COALESCE(sum(monto_ves), 0) INTO apl FROM notas_cxc_aplicacion WHERE nota_id = NEW.id;
    -- Si la venta es anterior a la contabilidad automática, 1.1.06 nunca recibió su cargo: no se puede abonar.
    IF apl > 0 AND NOT EXISTS (SELECT 1 FROM asientos WHERE origen_tipo = 'VENTA' AND origen_id = NEW.venta_id) THEN apl := 0; END IF;
    lineas := jsonb_build_array(jsonb_build_object('cuenta_id', fn_cuenta_param('VENTAS'), 'debe', NEW.base_ves, 'glosa', 'Nota de crédito ' || NEW.numero));
    IF NEW.iva_ves > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('IVA_DEBITO'), 'debe', NEW.iva_ves, 'glosa', 'IVA de la nota de crédito'); END IF;
    IF apl > 0 THEN
        lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('CUENTAS_POR_COBRAR'), 'haber', apl, 'glosa', 'Baja de la deuda del cliente (venta ' || v_numero || ')');
    END IF;
    IF NEW.total_ves - apl > 0 THEN
        lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_pago_venta(NEW.venta_id), 'haber', NEW.total_ves - apl, 'glosa', 'Devolución al cliente (venta ' || v_numero || ')');
    END IF;
    PERFORM fn_crear_asiento(NEW.fecha, 'Nota de crédito ' || NEW.numero || ' sobre la venta ' || v_numero, 'NOTA_CREDITO', NEW.id, lineas, NEW.usuario_id);
    RETURN NULL;
END $$;

-- Una venta a crédito con notas aplicadas a su deuda no se anula (el contra-asiento abonaría 1.1.06 dos veces).
CREATE OR REPLACE FUNCTION trg_cxc_venta_anulada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c cuentas_por_cobrar;
BEGIN
    SELECT * INTO c FROM cuentas_por_cobrar WHERE venta_id = NEW.id FOR UPDATE;
    IF c.id IS NULL THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM pagos_cobrar WHERE cuenta_por_cobrar_id = c.id AND estado = 'ACTIVO') THEN
        RAISE EXCEPTION 'La venta % tiene cobros registrados. Anula primero esos cobros en Cuentas por cobrar.', NEW.numero USING ERRCODE = 'TV005';
    END IF;
    IF EXISTS (SELECT 1 FROM notas_cxc_aplicacion WHERE cuenta_por_cobrar_id = c.id) THEN
        RAISE EXCEPTION 'La venta % tiene notas de crédito aplicadas a su deuda: no se puede anular. Emite notas de crédito por lo que falte.', NEW.numero USING ERRCODE = 'TV005';
    END IF;
    UPDATE cuentas_por_cobrar SET estado = 'ANULADA', saldo_usd = 0, saldo_ves = 0 WHERE id = c.id;
    RETURN NULL;
END $$;

-- ---------------------------------------------------------------------------
--  G. IGTF a declarar: ahora suma los cobros de cuentas por cobrar
-- ---------------------------------------------------------------------------
--  Mismas columnas que antes (Libros fiscales, Resumen quincenal y Conciliación la leen tal cual). Un cobro anulado sigue
--  contando como percibido y entra en las columnas «de anuladas» (reintegro por reclamar), igual que una venta anulada.
CREATE OR REPLACE VIEW v_igtf_a_declarar AS
WITH f AS (
    SELECT v.fecha_valor AS fecha, CASE WHEN pv.aplica_igtf THEN pv.monto_usd END AS base_usd,
           pv.igtf_usd AS igtf_usd, pv.igtf_ves AS igtf_ves, (v.estado = 'ANULADA') AS anulada
      FROM pagos_venta pv JOIN ventas v ON v.id = pv.venta_id
    UNION ALL
    SELECT pc.fecha, CASE WHEN pc.aplica_igtf THEN pc.monto_usd END, pc.igtf_usd, pc.igtf_ves, (pc.estado = 'ANULADO')
      FROM pagos_cobrar pc WHERE pc.igtf_usd > 0
)
SELECT fecha,
       sum(base_usd)                                              AS base_divisas_usd,
       sum(igtf_usd)                                              AS igtf_usd,
       sum(igtf_ves)                                              AS igtf_ves,
       COALESCE(sum(igtf_usd) FILTER (WHERE anulada), 0)          AS igtf_de_ventas_anuladas_usd,
       COALESCE(sum(igtf_ves) FILTER (WHERE anulada), 0)          AS igtf_de_ventas_anuladas_ves
  FROM f GROUP BY fecha HAVING sum(igtf_usd) > 0 ORDER BY fecha DESC;
COMMENT ON VIEW v_igtf_a_declarar IS 'IGTF a declarar por día: lo percibido en divisas en ventas (fecha de la venta) y en cobros de cuentas por cobrar (fecha del cobro), incluso de documentos luego anulados (igtf_de_ventas_anuladas_* = parte anulada, se reclama aparte). Basado en fuentes secundarias; confirmar con el contador.';

-- Cuentas por cobrar: cuánto bajaron las notas de crédito (informativo).
CREATE OR REPLACE VIEW v_notas_cxc AS
SELECT a.cuenta_por_cobrar_id, a.nota_id, n.numero AS nota_numero, n.fecha, a.monto_usd, a.monto_ves, n.total_ves - a.monto_ves AS devuelto_en_dinero_ves
  FROM notas_cxc_aplicacion a JOIN notas_ajuste n ON n.id = a.nota_id;
COMMENT ON VIEW v_notas_cxc IS 'Notas de crédito aplicadas a la deuda de una venta a crédito y lo que excedió (devuelto en dinero).';
