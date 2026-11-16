-- =============================================================================
--  18 · Devolución del dinero de una nota de crédito (egreso de caja del turno)
-- =============================================================================
--  Requiere: 14, 15, 16 y 17. Es idempotente.
--     psql -d tienda -v ON_ERROR_STOP=1 -f 18_devolucion_en_caja.sql
--
--  Problema que resuelve: una nota de crédito sobre una venta pagada (o el excedente sobre la deuda de una venta a crédito)
--  se devuelve al cliente en dinero. El asiento contable ya acredita Caja/Bancos, pero la caja del turno no lo sabía y el
--  Corte Z esperaba billetes que ya no estaban en la gaveta.
--
--  fn_devolver_nota_en_caja registra ese EGRESO en el turno abierto de quien emite la nota, con el método de pago elegido
--  (efectivo → cuenta en el arqueo y exige turno abierto; transferencia / pago móvil → queda anotado, no mueve la gaveta).
--  Se llama en la MISMA transacción que la nota: si falla (no hay turno, monto de más), la nota tampoco se registra.
--  No genera asiento nuevo: el de la nota ya lo trae.
-- =============================================================================
SET search_path = tienda, public;

ALTER TABLE movimientos_caja ADD COLUMN IF NOT EXISTS nota_id bigint REFERENCES notas_ajuste(id);
ALTER TABLE movimientos_caja DROP CONSTRAINT IF EXISTS movimientos_caja_origen_check;
ALTER TABLE movimientos_caja ADD CONSTRAINT movimientos_caja_origen_check CHECK (origen IN ('MANUAL','COBRO_CXC','ANULACION_COBRO','NOTA_CREDITO'));
CREATE INDEX IF NOT EXISTS ix_mov_caja_nota ON movimientos_caja (nota_id) WHERE nota_id IS NOT NULL;
COMMENT ON COLUMN movimientos_caja.nota_id IS 'Nota de crédito cuyo dinero se devolvió con este egreso (origen NOTA_CREDITO).';

-- fn_registrar_movimiento_caja gana p_nota_id (se reemplaza: con dos firmas, las llamadas serían ambiguas).
DROP FUNCTION IF EXISTS fn_registrar_movimiento_caja(bigint, text, text, char, numeric, text, text, bigint, boolean, boolean);
CREATE OR REPLACE FUNCTION fn_registrar_movimiento_caja(
    p_usuario_id bigint, p_tipo text, p_concepto text, p_moneda char(3), p_monto numeric, p_referencia text DEFAULT NULL,
    p_origen text DEFAULT 'MANUAL', p_pago_cobrar_id bigint DEFAULT NULL, p_es_efectivo boolean DEFAULT true, p_obligatorio boolean DEFAULT true,
    p_nota_id bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE ap bigint; t_usd numeric; t_ves numeric; v_id bigint;
BEGIN
    IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF p_concepto IS NULL OR length(trim(p_concepto)) < 3 THEN RAISE EXCEPTION 'Escribe el concepto del movimiento' USING ERRCODE = 'TV006'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('tienda.apertura.' || p_usuario_id));
    ap := fn_apertura_activa(p_usuario_id);
    IF ap IS NULL THEN
        IF p_obligatorio THEN RAISE EXCEPTION 'Debes abrir la caja para registrar movimientos' USING ERRCODE = 'TV005'; END IF;
        RETURN NULL;
    END IF;
    t_usd := CASE WHEN p_moneda = 'USD' THEN 1 ELSE fn_tasa_par(p_moneda, 'USD', fn_hoy()) END;
    t_ves := CASE WHEN p_moneda = 'VES' THEN 1 ELSE fn_tasa_par(p_moneda, 'VES', fn_hoy()) END;
    INSERT INTO movimientos_caja (apertura_id, tipo, concepto, monto, moneda, tasa_usd, tasa_ves, monto_usd, monto_ves, referencia, es_efectivo, origen, pago_cobrar_id, nota_id, usuario_id)
    VALUES (ap, p_tipo, trim(p_concepto), ROUND(p_monto, 2), p_moneda, t_usd, t_ves, ROUND(p_monto * t_usd, 2), ROUND(p_monto * t_ves, 2),
            NULLIF(trim(p_referencia), ''), COALESCE(p_es_efectivo, true), p_origen, p_pago_cobrar_id, p_nota_id, p_usuario_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- El mensaje de «no se anula aquí» ahora cubre también los egresos de notas de crédito.
CREATE OR REPLACE FUNCTION fn_anular_movimiento_caja(p_id bigint, p_motivo text, p_usuario_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m movimientos_caja; a aperturas_caja;
BEGIN
    SELECT * INTO m FROM movimientos_caja WHERE id = p_id FOR UPDATE;
    IF m.id IS NULL THEN RAISE EXCEPTION 'El movimiento no existe' USING ERRCODE = 'TV006'; END IF;
    IF m.estado = 'ANULADO' THEN RAISE EXCEPTION 'Ese movimiento ya está anulado' USING ERRCODE = 'TV006'; END IF;
    IF m.origen <> 'MANUAL' THEN RAISE EXCEPTION 'Este movimiento viene de un cobro o de una nota de crédito: no se anula aquí' USING ERRCODE = 'TV005'; END IF;
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO a FROM aperturas_caja WHERE id = m.apertura_id;
    IF a.estado <> 'ABIERTA' THEN RAISE EXCEPTION 'El turno de ese movimiento ya está cerrado: no se puede anular' USING ERRCODE = 'TV005'; END IF;
    UPDATE movimientos_caja SET estado = 'ANULADO', anulado_en = now(), anulado_por = p_usuario_id, motivo_anulacion = trim(p_motivo) WHERE id = p_id;
END $$;

-- Dinero que todavía se le puede devolver al cliente por una nota de crédito (en Bs):
-- total de la nota − lo que bajó de su deuda − lo ya devuelto en caja.
CREATE OR REPLACE FUNCTION fn_nota_reembolsable_ves(p_nota_id bigint) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT GREATEST(0, n.total_ves
        - COALESCE((SELECT sum(a.monto_ves) FROM notas_cxc_aplicacion a WHERE a.nota_id = n.id), 0)
        - COALESCE((SELECT sum(m.monto_ves) FROM movimientos_caja m WHERE m.nota_id = n.id AND m.estado = 'ACTIVO'), 0))
      FROM notas_ajuste n WHERE n.id = p_nota_id AND n.tipo = 'C'
$$;

-- Registra la devolución del dinero. p_monto NULL = todo lo reembolsable (en la moneda del método, a la tasa de hoy).
CREATE OR REPLACE FUNCTION fn_devolver_nota_en_caja(
    p_nota_id bigint, p_metodo_pago_id bigint, p_monto numeric, p_usuario_id bigint, p_referencia text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n notas_ajuste; m metodos_pago; reemb numeric; t_ves numeric; v_monto numeric; v_num text; v_id bigint; moneda char(3);
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('tienda.nota.devolucion.' || p_nota_id));
    SELECT * INTO n FROM notas_ajuste WHERE id = p_nota_id;
    IF n.id IS NULL THEN RAISE EXCEPTION 'La nota no existe' USING ERRCODE = 'TV006'; END IF;
    IF n.tipo <> 'C' THEN RAISE EXCEPTION 'Solo una nota de crédito devuelve dinero al cliente' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO m FROM metodos_pago WHERE id = p_metodo_pago_id AND activo;
    IF m.id IS NULL THEN RAISE EXCEPTION 'Elige con qué método se devuelve el dinero' USING ERRCODE = 'TV006'; END IF;
    IF m.requiere_referencia AND length(trim(COALESCE(p_referencia, ''))) = 0 THEN
        RAISE EXCEPTION 'Anota la referencia de la devolución por %', m.nombre USING ERRCODE = 'TV006';
    END IF;
    reemb := fn_nota_reembolsable_ves(p_nota_id);
    IF reemb <= 0 THEN
        RAISE EXCEPTION 'Esta nota se aplicó completa a la deuda del cliente: no hay dinero que devolver' USING ERRCODE = 'TV005';
    END IF;
    moneda := m.moneda;
    t_ves := CASE WHEN moneda = 'VES' THEN 1 ELSE fn_tasa_par(moneda, 'VES', fn_hoy()) END;
    v_monto := COALESCE(ROUND(p_monto, 2), ROUND(reemb / t_ves, 2));
    IF v_monto <= 0 THEN RAISE EXCEPTION 'El monto a devolver debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF v_monto * t_ves > reemb + t_ves * 0.005 THEN            -- media centésima de tolerancia por redondeo
        RAISE EXCEPTION 'Solo puedes devolver hasta % % por esta nota (Bs %)', trim(moneda), to_char(ROUND(reemb / t_ves, 2), 'FM999G999G990D00'), to_char(reemb, 'FM999G999G999G990D00') USING ERRCODE = 'TV006';
    END IF;
    SELECT numero INTO v_num FROM ventas WHERE id = n.venta_id;
    v_id := fn_registrar_movimiento_caja(p_usuario_id, 'EGRESO', 'Devolución nota de crédito ' || n.numero || ' · venta ' || COALESCE(v_num, n.venta_id::text),
                                         moneda, v_monto, p_referencia, 'NOTA_CREDITO', NULL, m.es_efectivo, m.es_efectivo, p_nota_id);
    RETURN v_id;       -- NULL solo si el método no es efectivo y el usuario no tiene turno abierto (queda sin anotar en caja)
END $$;
COMMENT ON FUNCTION fn_devolver_nota_en_caja(bigint, bigint, numeric, bigint, text) IS 'Egreso de caja por el dinero devuelto de una nota de crédito. En efectivo exige turno abierto. No crea asiento (la nota ya lo trae).';
