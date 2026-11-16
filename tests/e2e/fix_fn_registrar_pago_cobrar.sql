-- Parche E2E: la fecha del cobro se compara con el día local (Caracas) y no con el día UTC
-- de created_at. Sin este fix, todo cobro del mismo día después de las 20:00 fallaba.
-- Ya aplicado en database/sql/15 y 16; este archivo sirve para reinstalarlo por separado.
SET search_path = tienda, public;

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
    SELECT * INTO neg FROM negocio WHERE id = 1;
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
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = 1), false)
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
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = 1), false) THEN
        PERFORM fn_contra_asiento('COBRO_CLIENTE', p.id, 'ANULACION_COBRO', fn_hoy(), 'Anulación del cobro N.º ' || p.id, p_usuario_id);
    END IF;
END $$;
