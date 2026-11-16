-- =============================================================================
--  39 · ASIENTOS CONTABLES DEL ISLR ANUAL (multiinquilino)
-- =============================================================================
--  Requiere: 10 (contabilidad), 15 (cuentas por cobrar), 19/20 (ISLR retenido), 36 (declaración). Va DESPUÉS de 38. Idempotente.
--
--  Lo que YA generaba asiento (20): la retención que TÚ practicas a proveedores y su entero al SENIAT.
--  Lo que faltaba y este script agrega, con contabilidad automática activa:
--    · Anticipo de ISLR pagado ............ Debe  1.1.08 Anticipos de ISLR pagados     / Haber 1.1.02 Bancos
--    · ISLR que te retuvo un cliente ...... Debe  1.1.09 ISLR retenido a favor         / Haber 1.1.06 Cuentas por cobrar a clientes
--    · Liquidación del ejercicio .......... Debe  5.3.01 Gasto por ISLR                / Haber 1.1.09, 1.1.08 (lo que se aplica) y 2.1.06 ISLR del ejercicio por pagar
--    · Pago del saldo al SENIAT ........... Debe  2.1.06                               / Haber 1.1.02 Bancos
--  Cada anulación genera su contra-asiento (los asientos son inmutables). Un ejercicio liquidado no admite anticipos ni retenciones
--  nuevas ni anuladas: primero se descontabiliza (contra-asiento) y luego se vuelve a liquidar.
--
--  SUPUESTOS que tu contador debe confirmar (la técnica la define VEN-NIF y su criterio, no el sistema):
--    1. La retención que te hace un cliente se registra contra Cuentas por cobrar (el cliente te paga neto de la retención).
--    2. El gasto de ISLR se reconoce al cierre del ejercicio por el impuesto neto de rebajas, sin impuesto diferido.
--    3. Si los anticipos y retenciones superan el impuesto, el excedente queda como activo (1.1.08 / 1.1.09) para compensar o recuperar.
--  El sistema NO presenta la declaración: la Forma 33 del SENIAT es la de enajenación de inmuebles; la de rentas de personas jurídicas
--  se presenta en el portal del SENIAT con las cifras del borrador y los anexos que arme tu contador.
-- =============================================================================
SET search_path = tienda, public;

-- ── Tipos de asiento nuevos ──
ALTER TABLE asientos DROP CONSTRAINT IF EXISTS asientos_origen_tipo_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN
    ('MANUAL','APERTURA','VENTA','ANULACION_VENTA','COMPRA','ANULACION_COMPRA','NOTA_CREDITO','NOTA_DEBITO','DEVOLUCION_COSTO','PAGO_PROVEEDOR','ANULACION_PAGO','CIERRE','AJUSTE_CAMBIARIO','COBRO_CLIENTE','ANULACION_COBRO',
     'RETENCION_ISLR','ANULACION_RETENCION_ISLR','ENTERO_ISLR','ANULACION_ENTERO_ISLR',
     'ISLR_ANTICIPO','ANULACION_ISLR_ANTICIPO','ISLR_SUFRIDA','ANULACION_ISLR_SUFRIDA','ISLR_EJERCICIO','ANULACION_ISLR_EJERCICIO','ISLR_PAGO'));

-- ── Cuentas y parámetros nuevos, para CADA negocio (y por tanto para los que se provisionen después: copian el 1) ──
DO $$
DECLARE n record;
BEGIN
    FOR n IN SELECT id FROM tienda.negocio LOOP
        PERFORM set_config('app.negocio_id', n.id::text, true);
        INSERT INTO tienda.plan_cuentas (negocio_id, codigo, nombre, tipo, cuenta_padre_id, permite_movimiento)
        SELECT n.id, x.codigo, x.nombre, x.tipo, (SELECT id FROM tienda.plan_cuentas WHERE codigo = x.padre AND negocio_id = n.id), x.mov
          FROM (VALUES
            ('1.1.08', 'Anticipos de ISLR pagados',                'ACTIVO', '1.1', true),
            ('1.1.09', 'ISLR retenido por clientes (a favor)',     'ACTIVO', '1.1', true),
            ('2.1.06', 'ISLR del ejercicio por pagar',             'PASIVO', '2.1', true),
            ('5.3',    'Impuestos',                                'GASTO',  '5',   false)
          ) AS x(codigo, nombre, tipo, padre, mov)
         WHERE NOT EXISTS (SELECT 1 FROM tienda.plan_cuentas p WHERE p.codigo = x.codigo AND p.negocio_id = n.id);
        INSERT INTO tienda.plan_cuentas (negocio_id, codigo, nombre, tipo, cuenta_padre_id, permite_movimiento)
        SELECT n.id, '5.3.01', 'Gasto por impuesto sobre la renta', 'GASTO', (SELECT id FROM tienda.plan_cuentas WHERE codigo = '5.3' AND negocio_id = n.id), true
         WHERE NOT EXISTS (SELECT 1 FROM tienda.plan_cuentas p WHERE p.codigo = '5.3.01' AND p.negocio_id = n.id);
        INSERT INTO tienda.contab_parametros (negocio_id, clave, cuenta_id, nota)
        SELECT n.id, x.clave, (SELECT id FROM tienda.plan_cuentas WHERE codigo = x.codigo AND negocio_id = n.id), x.nota
          FROM (VALUES
            ('ISLR_ANTICIPOS',          '1.1.08', 'Anticipos de ISLR (declaración estimada) pagados al SENIAT'),
            ('ISLR_A_FAVOR',            '1.1.09', 'ISLR que te retuvieron tus clientes: crédito contra el impuesto del ejercicio'),
            ('ISLR_EJERCICIO_POR_PAGAR','2.1.06', 'Saldo del impuesto del ejercicio pendiente de pagar al SENIAT'),
            ('GASTO_ISLR',              '5.3.01', 'Gasto por el impuesto sobre la renta del ejercicio')
          ) AS x(clave, codigo, nota)
         WHERE NOT EXISTS (SELECT 1 FROM tienda.contab_parametros c WHERE c.clave = x.clave AND c.negocio_id = n.id);
    END LOOP;
END $$;

-- ── Estado contable de la declaración ──
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='tienda' AND table_name='islr_declaracion' AND column_name='contabilizada') THEN
        ALTER TABLE tienda.islr_declaracion
            ADD COLUMN contabilizada boolean NOT NULL DEFAULT false,
            ADD COLUMN version_asiento smallint NOT NULL DEFAULT 0,
            ADD COLUMN pagada boolean NOT NULL DEFAULT false;
    END IF;
END $$;

-- ── Auxiliares ──
CREATE OR REPLACE FUNCTION fn_contab_automatica() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false)
$$;

-- origen_id del asiento de un ejercicio: único en toda la base (el índice de origen es global) y distinto por versión.
CREATE OR REPLACE FUNCTION fn_islr_origen(p_ejercicio int, p_version int) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
    SELECT (fn_negocio_actual()::bigint * 10000 + p_ejercicio) * 100 + p_version
$$;

-- Un ejercicio liquidado no admite movimientos nuevos ni anulados en sus fechas.
CREATE OR REPLACE FUNCTION fn_islr_ejercicio_abierto(p_fecha date) RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE e int;
BEGIN
    SELECT ejercicio INTO e FROM islr_declaracion WHERE negocio_id = fn_negocio_actual() AND contabilizada AND p_fecha BETWEEN desde AND hasta;
    IF e IS NOT NULL THEN
        RAISE EXCEPTION 'El ejercicio % ya está liquidado en la contabilidad: descontabilízalo antes de registrar o anular anticipos o retenciones de esas fechas', e USING ERRCODE = 'TV006';
    END IF;
END $$;

-- ── Anticipos y retenciones sufridas: ahora con asiento ──
CREATE OR REPLACE FUNCTION fn_islr_anticipo_registrar(p_fecha date, p_periodo date, p_monto numeric, p_ref text, p_obs text, p_usuario_id bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
    IF p_fecha IS NULL OR p_fecha > fn_hoy() THEN RAISE EXCEPTION 'La fecha del pago no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'Escribe el monto pagado' USING ERRCODE = 'TV006'; END IF;
    PERFORM fn_islr_ejercicio_abierto(p_fecha);
    INSERT INTO islr_anticipos (negocio_id, fecha_pago, periodo, monto_ves, referencia, observaciones, usuario_id)
    VALUES (fn_negocio_actual(), p_fecha, CASE WHEN p_periodo IS NULL THEN NULL ELSE date_trunc('month', p_periodo)::date END, round(p_monto, 2), NULLIF(trim(p_ref), ''), NULLIF(trim(p_obs), ''), p_usuario_id)
    RETURNING id INTO v_id;
    IF fn_contab_automatica() THEN
        PERFORM fn_crear_asiento(p_fecha, 'Anticipo de ISLR' || COALESCE(' · ' || NULLIF(trim(p_ref), ''), ''), 'ISLR_ANTICIPO', v_id, jsonb_build_array(
            jsonb_build_object('cuenta_id', fn_cuenta_param('ISLR_ANTICIPOS'), 'debe', round(p_monto, 2), 'glosa', 'Anticipo de ISLR pagado al SENIAT'),
            jsonb_build_object('cuenta_id', fn_cuenta_param('BANCOS'), 'haber', round(p_monto, 2), 'glosa', 'Pago del anticipo')), p_usuario_id);
    END IF;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_islr_anticipo_anular(p_id bigint, p_motivo text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f date;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    SELECT fecha_pago INTO f FROM islr_anticipos WHERE negocio_id = fn_negocio_actual() AND id = p_id AND estado = 'ACTIVO' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese anticipo no existe o ya está anulado' USING ERRCODE = 'TV006'; END IF;
    PERFORM fn_islr_ejercicio_abierto(f);
    UPDATE islr_anticipos SET estado = 'ANULADO', anulada_en = now(), motivo_anulacion = trim(p_motivo) WHERE negocio_id = fn_negocio_actual() AND id = p_id;
    PERFORM fn_contra_asiento('ISLR_ANTICIPO', p_id, 'ANULACION_ISLR_ANTICIPO', fn_hoy(), 'Anulación de anticipo de ISLR #' || p_id, NULL);
END $$;

CREATE OR REPLACE FUNCTION fn_islr_sufrida_registrar(p_fecha date, p_nombre text, p_rif text, p_comprobante text, p_documento text, p_base numeric, p_retenido numeric, p_obs text, p_usuario_id bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
    IF p_fecha IS NULL OR p_fecha > fn_hoy() THEN RAISE EXCEPTION 'La fecha del comprobante no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF p_nombre IS NULL OR length(trim(p_nombre)) < 3 THEN RAISE EXCEPTION 'Escribe el nombre de quien te retuvo' USING ERRCODE = 'TV006'; END IF;
    IF p_rif IS NULL OR NOT fn_validar_rif(upper(trim(p_rif))) THEN RAISE EXCEPTION 'El RIF de quien te retuvo no es válido' USING ERRCODE = 'TV006'; END IF;
    IF p_base IS NULL OR p_base <= 0 THEN RAISE EXCEPTION 'Escribe la base sobre la que te retuvieron' USING ERRCODE = 'TV006'; END IF;
    IF p_retenido IS NULL OR p_retenido <= 0 THEN RAISE EXCEPTION 'Escribe el monto que te retuvieron' USING ERRCODE = 'TV006'; END IF;
    IF p_retenido > p_base THEN RAISE EXCEPTION 'Lo retenido no puede ser mayor que la base' USING ERRCODE = 'TV006'; END IF;
    IF NULLIF(trim(p_comprobante), '') IS NOT NULL AND EXISTS (SELECT 1 FROM islr_retenciones_sufridas WHERE negocio_id = fn_negocio_actual() AND estado = 'ACTIVO' AND upper(agente_rif) = upper(trim(p_rif)) AND upper(comprobante) = upper(trim(p_comprobante))) THEN
        RAISE EXCEPTION 'Ya registraste ese comprobante de ese cliente' USING ERRCODE = 'TV005'; END IF;
    PERFORM fn_islr_ejercicio_abierto(p_fecha);
    INSERT INTO islr_retenciones_sufridas (negocio_id, fecha, agente_nombre, agente_rif, comprobante, documento, base_ves, retenido_ves, observaciones, usuario_id)
    VALUES (fn_negocio_actual(), p_fecha, trim(p_nombre), upper(trim(p_rif)), NULLIF(trim(p_comprobante), ''), NULLIF(trim(p_documento), ''), round(p_base, 2), round(p_retenido, 2), NULLIF(trim(p_obs), ''), p_usuario_id)
    RETURNING id INTO v_id;
    IF fn_contab_automatica() THEN
        PERFORM fn_crear_asiento(p_fecha, 'ISLR retenido por ' || trim(p_nombre) || COALESCE(' · comprobante ' || NULLIF(trim(p_comprobante), ''), ''), 'ISLR_SUFRIDA', v_id, jsonb_build_array(
            jsonb_build_object('cuenta_id', fn_cuenta_param('ISLR_A_FAVOR'), 'debe', round(p_retenido, 2), 'glosa', 'ISLR que te retuvo tu cliente (crédito contra tu impuesto)'),
            jsonb_build_object('cuenta_id', fn_cuenta_param('CUENTAS_POR_COBRAR'), 'haber', round(p_retenido, 2), 'glosa', 'Parte de la factura que el cliente no te paga: la entrega al SENIAT')), p_usuario_id);
    END IF;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_islr_sufrida_anular(p_id bigint, p_motivo text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f date;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    SELECT fecha INTO f FROM islr_retenciones_sufridas WHERE negocio_id = fn_negocio_actual() AND id = p_id AND estado = 'ACTIVO' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa retención no existe o ya está anulada' USING ERRCODE = 'TV006'; END IF;
    PERFORM fn_islr_ejercicio_abierto(f);
    UPDATE islr_retenciones_sufridas SET estado = 'ANULADO', anulada_en = now(), motivo_anulacion = trim(p_motivo) WHERE negocio_id = fn_negocio_actual() AND id = p_id;
    PERFORM fn_contra_asiento('ISLR_SUFRIDA', p_id, 'ANULACION_ISLR_SUFRIDA', fn_hoy(), 'Anulación de retención de ISLR sufrida #' || p_id, NULL);
END $$;


-- ── Liquidación del ejercicio: gasto de ISLR contra anticipos, retenciones sufridas y saldo por pagar ──
CREATE OR REPLACE FUNCTION fn_islr_contabilizar(p_ejercicio int, p_usuario_id bigint DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE d islr_declaracion; b jsonb; neto numeric; suf numeric; ant numeric; ap_s numeric; ap_a numeric; por_pagar numeric; lineas jsonb; v_id bigint; sin_asiento int;
BEGIN
    IF NOT fn_contab_automatica() THEN RAISE EXCEPTION 'Activa la contabilidad automática para liquidar el ISLR en los libros' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO d FROM islr_declaracion WHERE negocio_id = fn_negocio_actual() AND ejercicio = p_ejercicio FOR UPDATE;
    IF d.ejercicio IS NULL THEN RAISE EXCEPTION 'Primero guarda las cifras del ejercicio %', p_ejercicio USING ERRCODE = 'TV006'; END IF;
    IF d.contabilizada THEN RAISE EXCEPTION 'El ejercicio % ya está liquidado en la contabilidad', p_ejercicio USING ERRCODE = 'TV006'; END IF;
    b := fn_islr_borrador(p_ejercicio);
    IF b->>'impuesto_neto' IS NULL THEN RAISE EXCEPTION 'No se puede calcular el impuesto: faltan la unidad tributaria o los tramos de la tarifa' USING ERRCODE = 'TV006'; END IF;
    neto := (b->>'impuesto_neto')::numeric;
    IF neto <= 0 THEN RAISE EXCEPTION 'El impuesto neto del ejercicio es cero: no hay nada que liquidar' USING ERRCODE = 'TV006'; END IF;

    SELECT count(*) INTO sin_asiento FROM (
        SELECT a.id FROM islr_anticipos a WHERE a.negocio_id = fn_negocio_actual() AND a.estado = 'ACTIVO' AND a.fecha_pago BETWEEN d.desde AND d.hasta
           AND NOT EXISTS (SELECT 1 FROM asientos s WHERE s.origen_tipo = 'ISLR_ANTICIPO' AND s.origen_id = a.id)
        UNION ALL
        SELECT r.id FROM islr_retenciones_sufridas r WHERE r.negocio_id = fn_negocio_actual() AND r.estado = 'ACTIVO' AND r.fecha BETWEEN d.desde AND d.hasta
           AND NOT EXISTS (SELECT 1 FROM asientos s WHERE s.origen_tipo = 'ISLR_SUFRIDA' AND s.origen_id = r.id)) x;
    IF sin_asiento > 0 THEN
        RAISE EXCEPTION 'Hay % anticipos o retenciones del ejercicio sin asiento (se registraron antes de activar la contabilidad). Anúlalos y regístralos de nuevo', sin_asiento USING ERRCODE = 'TV006';
    END IF;

    suf := COALESCE((b->>'retenciones_sufridas')::numeric, 0); ant := COALESCE((b->>'anticipos')::numeric, 0);
    ap_s := LEAST(suf, neto); ap_a := LEAST(ant, neto - ap_s); por_pagar := neto - ap_s - ap_a;
    lineas := jsonb_build_array(jsonb_build_object('cuenta_id', fn_cuenta_param('GASTO_ISLR'), 'debe', neto, 'glosa', 'Impuesto sobre la renta del ejercicio ' || p_ejercicio));
    IF ap_s > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('ISLR_A_FAVOR'), 'haber', ap_s, 'glosa', 'Retenciones que te practicaron tus clientes'); END IF;
    IF ap_a > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('ISLR_ANTICIPOS'), 'haber', ap_a, 'glosa', 'Anticipos pagados'); END IF;
    IF por_pagar > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('ISLR_EJERCICIO_POR_PAGAR'), 'haber', por_pagar, 'glosa', 'Saldo a pagar al SENIAT'); END IF;
    v_id := fn_crear_asiento(d.hasta, 'Liquidación del ISLR del ejercicio ' || p_ejercicio, 'ISLR_EJERCICIO', fn_islr_origen(p_ejercicio, d.version_asiento), lineas, p_usuario_id);
    UPDATE islr_declaracion SET contabilizada = true, pagada = (por_pagar = 0) WHERE negocio_id = fn_negocio_actual() AND ejercicio = p_ejercicio;
    RETURN v_id;
END $$;

-- Paga al SENIAT el saldo que dejó la liquidación (Debe ISLR por pagar / Haber Bancos).
CREATE OR REPLACE FUNCTION fn_islr_pagar(p_ejercicio int, p_fecha date, p_usuario_id bigint DEFAULT NULL) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE d islr_declaracion; monto numeric; v_id bigint;
BEGIN
    SELECT * INTO d FROM islr_declaracion WHERE negocio_id = fn_negocio_actual() AND ejercicio = p_ejercicio FOR UPDATE;
    IF d.ejercicio IS NULL OR NOT d.contabilizada THEN RAISE EXCEPTION 'Primero liquida el ejercicio % en la contabilidad', p_ejercicio USING ERRCODE = 'TV006'; END IF;
    IF d.pagada THEN RAISE EXCEPTION 'El saldo del ejercicio % ya está pagado (o no había saldo)', p_ejercicio USING ERRCODE = 'TV006'; END IF;
    IF p_fecha IS NULL OR p_fecha > fn_hoy() THEN RAISE EXCEPTION 'La fecha del pago no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    SELECT x.haber INTO monto FROM asientos a JOIN asiento_detalle x ON x.asiento_id = a.id
     WHERE a.origen_tipo = 'ISLR_EJERCICIO' AND a.origen_id = fn_islr_origen(p_ejercicio, d.version_asiento) AND x.cuenta_id = fn_cuenta_param('ISLR_EJERCICIO_POR_PAGAR');
    IF COALESCE(monto, 0) <= 0 THEN RAISE EXCEPTION 'La liquidación no dejó saldo por pagar' USING ERRCODE = 'TV006'; END IF;
    v_id := fn_crear_asiento(p_fecha, 'Pago del ISLR del ejercicio ' || p_ejercicio || ' al SENIAT', 'ISLR_PAGO', fn_islr_origen(p_ejercicio, d.version_asiento), jsonb_build_array(
        jsonb_build_object('cuenta_id', fn_cuenta_param('ISLR_EJERCICIO_POR_PAGAR'), 'debe', monto, 'glosa', 'Saldo del ejercicio ' || p_ejercicio),
        jsonb_build_object('cuenta_id', fn_cuenta_param('BANCOS'), 'haber', monto, 'glosa', 'Pago al SENIAT')), p_usuario_id);
    UPDATE islr_declaracion SET pagada = true WHERE negocio_id = fn_negocio_actual() AND ejercicio = p_ejercicio;
    RETURN v_id;
END $$;

-- Revierte la liquidación (contra-asiento) para poder corregir cifras o movimientos y liquidar de nuevo. No se puede si ya se pagó el saldo.
CREATE OR REPLACE FUNCTION fn_islr_descontabilizar(p_ejercicio int, p_usuario_id bigint DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d islr_declaracion;
BEGIN
    SELECT * INTO d FROM islr_declaracion WHERE negocio_id = fn_negocio_actual() AND ejercicio = p_ejercicio FOR UPDATE;
    IF d.ejercicio IS NULL OR NOT d.contabilizada THEN RAISE EXCEPTION 'El ejercicio % no está liquidado en la contabilidad', p_ejercicio USING ERRCODE = 'TV006'; END IF;
    IF EXISTS (SELECT 1 FROM asientos WHERE origen_tipo = 'ISLR_PAGO' AND origen_id = fn_islr_origen(p_ejercicio, d.version_asiento)) THEN
        RAISE EXCEPTION 'El saldo del ejercicio % ya se pagó: pídele a tu contador un asiento de ajuste', p_ejercicio USING ERRCODE = 'TV006'; END IF;
    PERFORM fn_contra_asiento('ISLR_EJERCICIO', fn_islr_origen(p_ejercicio, d.version_asiento), 'ANULACION_ISLR_EJERCICIO', fn_hoy(), 'Reverso de la liquidación del ISLR del ejercicio ' || p_ejercicio, p_usuario_id);
    UPDATE islr_declaracion SET contabilizada = false, pagada = false, version_asiento = version_asiento + 1 WHERE negocio_id = fn_negocio_actual() AND ejercicio = p_ejercicio;
END $$;
