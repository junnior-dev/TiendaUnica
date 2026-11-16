-- =============================================================================
--  36 · ISLR anual (multiinquilino): anticipos pagados, retenciones que te practicaron, tarifa y borrador de la declaración
-- =============================================================================
--  Requiere: 20 (islr_ut, fn_islr_ut, retenciones_islr), 21/22/30 (calendario), 31 y 37 (v_libro_ventas con id_negocio) (multiinquilino: fn_negocio_actual, fn_sello_negocio, saas_app).
--  Va DESPUÉS de 31. Cada negocio ve y escribe SOLO lo suyo: negocio_id + RLS FORCE + sello, igual que las otras 63 tablas.
--  Es idempotente:  psql -d tienda -v ON_ERROR_STOP=1 -f 36_islr_declaracion.sql
--
--  Qué es y qué NO es:
--   · Son REGISTROS DE CONSULTA para armar el borrador de la declaración definitiva. No generan asientos: el tratamiento contable de los
--     anticipos y de las retenciones soportadas (cuenta de activo, crédito, etc.) lo decide tu contador.
--   · El sistema NO calcula la renta neta fiscal por tu cuenta: toma lo que SÍ sabe (ingresos del libro de ventas, costo congelado de lo
--     vendido, retenciones, anticipos) y lo demás (gastos, deducciones, ajuste por inflación, rebajas) lo escribe tu contador.
--   · La tarifa del impuesto NO viene cargada: se registra por tramos en unidades tributarias (porcentaje y sustraendo en UT) con lo que
--     te indique tu contador para ese ejercicio. Sin tramos el borrador muestra los datos pero no calcula el impuesto.
--   · Las personas jurídicas deben declarar aunque el resultado sea una pérdida.
--   · Las funciones filtran por negocio_id = fn_negocio_actual() de forma explícita (el RLS no aplica al superusuario); producción conecta como saas_app.
--   · Es un borrador de trabajo, no el formulario del SENIAT: la declaración se presenta en el portal.
-- =============================================================================
SET search_path = tienda, public;

-- ── Anticipos (declaración estimada) que ya pagaste ──────────────────────────
CREATE TABLE IF NOT EXISTS islr_anticipos (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    negocio_id       integer       NOT NULL REFERENCES negocio(id),
    fecha_pago       date          NOT NULL,
    periodo          date,                                     -- primer día del mes que cubre (opcional)
    monto_ves        numeric(18,2) NOT NULL CHECK (monto_ves > 0),
    referencia       varchar(60),
    observaciones    varchar(200),
    estado           varchar(8)    NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','ANULADO')),
    anulada_en       timestamptz,
    motivo_anulacion text,
    usuario_id       bigint REFERENCES usuarios(id),
    created_at       timestamptz   NOT NULL DEFAULT now()
);
COMMENT ON TABLE islr_anticipos IS 'Pagos de la declaración estimada de ISLR (anticipos) ya hechos. Con contabilidad automática genera su asiento (39).';

-- ── Retenciones de ISLR que TE practicaron tus clientes ──────────────────────
CREATE TABLE IF NOT EXISTS islr_retenciones_sufridas (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    negocio_id       integer       NOT NULL REFERENCES negocio(id),
    fecha            date          NOT NULL,
    agente_nombre    varchar(150)  NOT NULL CHECK (length(trim(agente_nombre)) >= 3),
    agente_rif       varchar(15)   NOT NULL,
    comprobante      varchar(40),                              -- número del comprobante que te entregó el cliente
    documento        varchar(40),                              -- tu factura afectada
    base_ves         numeric(18,2) NOT NULL CHECK (base_ves > 0),
    retenido_ves     numeric(18,2) NOT NULL CHECK (retenido_ves > 0),
    observaciones    varchar(200),
    estado           varchar(8)    NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','ANULADO')),
    anulada_en       timestamptz,
    motivo_anulacion text,
    usuario_id       bigint REFERENCES usuarios(id),
    created_at       timestamptz   NOT NULL DEFAULT now(),
    CHECK (retenido_ves <= base_ves)
);
CREATE INDEX IF NOT EXISTS ix_islr_sufridas_fecha ON islr_retenciones_sufridas (negocio_id, fecha);
CREATE INDEX IF NOT EXISTS ix_islr_anticipos_fecha ON islr_anticipos (negocio_id, fecha_pago);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_islr_sufrida ON islr_retenciones_sufridas (negocio_id, upper(agente_rif), upper(comprobante)) WHERE estado = 'ACTIVO' AND comprobante IS NOT NULL;
COMMENT ON TABLE islr_retenciones_sufridas IS 'Retenciones de ISLR que los clientes (agentes de retención) te practicaron: se descuentan del impuesto del ejercicio. Con contabilidad automática genera su asiento (39).';

-- No se borra ni se edita: solo se anula (con motivo).
CREATE OR REPLACE FUNCTION trg_islr_registro_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Los registros de ISLR no se borran: anúlalos con su motivo' USING ERRCODE = 'TV005'; END IF;
    IF OLD.estado = 'ACTIVO' AND NEW.estado = 'ANULADO'
       AND (to_jsonb(OLD) - 'estado' - 'anulada_en' - 'motivo_anulacion') = (to_jsonb(NEW) - 'estado' - 'anulada_en' - 'motivo_anulacion') THEN
        RETURN NEW; END IF;
    RAISE EXCEPTION 'Un registro de ISLR no se edita: anúlalo con su motivo y regístralo de nuevo' USING ERRCODE = 'TV005';
END $$;
DROP TRIGGER IF EXISTS trg_islr_anticipos_guardia ON islr_anticipos;
CREATE TRIGGER trg_islr_anticipos_guardia BEFORE UPDATE OR DELETE ON islr_anticipos FOR EACH ROW EXECUTE FUNCTION trg_islr_registro_guardia();
DROP TRIGGER IF EXISTS trg_islr_sufridas_guardia ON islr_retenciones_sufridas;
CREATE TRIGGER trg_islr_sufridas_guardia BEFORE UPDATE OR DELETE ON islr_retenciones_sufridas FOR EACH ROW EXECUTE FUNCTION trg_islr_registro_guardia();

-- ── Datos del ejercicio que escribe el contador ──────────────────────────────
CREATE TABLE IF NOT EXISTS islr_declaracion (
    negocio_id            integer NOT NULL REFERENCES negocio(id),
    ejercicio             int NOT NULL CHECK (ejercicio BETWEEN 2000 AND 2100),
    desde                 date NOT NULL,
    hasta                 date NOT NULL,
    costo_ventas_ves      numeric(18,2) CHECK (costo_ventas_ves >= 0),   -- si se escribe, reemplaza al costo del sistema
    gastos_ves            numeric(18,2) NOT NULL DEFAULT 0 CHECK (gastos_ves >= 0),
    otras_deducciones_ves numeric(18,2) NOT NULL DEFAULT 0 CHECK (otras_deducciones_ves >= 0),
    ajuste_inflacion_ves  numeric(18,2) NOT NULL DEFAULT 0,               -- con signo: + aumenta la renta, − la disminuye
    rebajas_ves           numeric(18,2) NOT NULL DEFAULT 0 CHECK (rebajas_ves >= 0),
    notas                 varchar(300),
    actualizado_por       bigint REFERENCES usuarios(id),
    actualizado_en        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (negocio_id, ejercicio),
    CHECK (hasta >= desde)
);
COMMENT ON TABLE islr_declaracion IS 'Cifras del ejercicio que aporta el contador (gastos, deducciones, ajuste por inflación, rebajas). El sistema no las inventa.';

CREATE TABLE IF NOT EXISTS islr_tarifa_tramos (
    negocio_id    integer       NOT NULL REFERENCES negocio(id),
    ejercicio     int           NOT NULL,
    desde_ut      numeric(14,2) NOT NULL CHECK (desde_ut >= 0),
    hasta_ut      numeric(14,2),                                -- NULL = sin tope
    pct           numeric(6,3)  NOT NULL CHECK (pct >= 0 AND pct <= 100),
    sustraendo_ut numeric(14,2) NOT NULL DEFAULT 0 CHECK (sustraendo_ut >= 0),
    PRIMARY KEY (negocio_id, ejercicio, desde_ut),
    CHECK (hasta_ut IS NULL OR hasta_ut > desde_ut)
);
COMMENT ON TABLE islr_tarifa_tramos IS 'Tarifa del impuesto del ejercicio por tramos en unidades tributarias: impuesto = renta en UT × % − sustraendo en UT (× valor de la UT). La indica el contador.';

-- ── Escritura ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_islr_anticipo_registrar(p_fecha date, p_periodo date, p_monto numeric, p_ref text, p_obs text, p_usuario_id bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
    IF p_fecha IS NULL OR p_fecha > fn_hoy() THEN RAISE EXCEPTION 'La fecha del pago no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'Escribe el monto pagado' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO islr_anticipos (negocio_id, fecha_pago, periodo, monto_ves, referencia, observaciones, usuario_id)
    VALUES (fn_negocio_actual(), p_fecha, CASE WHEN p_periodo IS NULL THEN NULL ELSE date_trunc('month', p_periodo)::date END, round(p_monto, 2), NULLIF(trim(p_ref), ''), NULLIF(trim(p_obs), ''), p_usuario_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_islr_anticipo_anular(p_id bigint, p_motivo text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    PERFORM 1 FROM islr_anticipos WHERE negocio_id = fn_negocio_actual() AND id = p_id AND estado = 'ACTIVO' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Ese anticipo no existe o ya está anulado' USING ERRCODE = 'TV006'; END IF;
    UPDATE islr_anticipos SET estado = 'ANULADO', anulada_en = now(), motivo_anulacion = trim(p_motivo) WHERE negocio_id = fn_negocio_actual() AND id = p_id;
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
    INSERT INTO islr_retenciones_sufridas (negocio_id, fecha, agente_nombre, agente_rif, comprobante, documento, base_ves, retenido_ves, observaciones, usuario_id)
    VALUES (fn_negocio_actual(), p_fecha, trim(p_nombre), upper(trim(p_rif)), NULLIF(trim(p_comprobante), ''), NULLIF(trim(p_documento), ''), round(p_base, 2), round(p_retenido, 2), NULLIF(trim(p_obs), ''), p_usuario_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_islr_sufrida_anular(p_id bigint, p_motivo text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    PERFORM 1 FROM islr_retenciones_sufridas WHERE negocio_id = fn_negocio_actual() AND id = p_id AND estado = 'ACTIVO' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Esa retención no existe o ya está anulada' USING ERRCODE = 'TV006'; END IF;
    UPDATE islr_retenciones_sufridas SET estado = 'ANULADO', anulada_en = now(), motivo_anulacion = trim(p_motivo) WHERE negocio_id = fn_negocio_actual() AND id = p_id;
END $$;

CREATE OR REPLACE FUNCTION fn_islr_declaracion_guardar(p_ejercicio int, p_desde date, p_hasta date, p_costo numeric, p_gastos numeric, p_otras numeric, p_ajuste numeric, p_rebajas numeric, p_notas text, p_usuario_id bigint)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ejercicio IS NULL OR p_ejercicio NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'El ejercicio no es válido' USING ERRCODE = 'TV006'; END IF;
    IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN RAISE EXCEPTION 'El ejercicio termina antes de empezar' USING ERRCODE = 'TV006'; END IF;
    IF p_hasta - p_desde > 380 THEN RAISE EXCEPTION 'Un ejercicio no puede durar más de un año' USING ERRCODE = 'TV006'; END IF;
    IF COALESCE(p_costo, 0) < 0 OR COALESCE(p_gastos, 0) < 0 OR COALESCE(p_otras, 0) < 0 OR COALESCE(p_rebajas, 0) < 0 THEN RAISE EXCEPTION 'Los montos no pueden ser negativos (solo el ajuste por inflación lleva signo)' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO islr_declaracion (negocio_id, ejercicio, desde, hasta, costo_ventas_ves, gastos_ves, otras_deducciones_ves, ajuste_inflacion_ves, rebajas_ves, notas, actualizado_por, actualizado_en)
    VALUES (fn_negocio_actual(), p_ejercicio, p_desde, p_hasta, round(p_costo, 2), round(COALESCE(p_gastos, 0), 2), round(COALESCE(p_otras, 0), 2), round(COALESCE(p_ajuste, 0), 2), round(COALESCE(p_rebajas, 0), 2), NULLIF(trim(p_notas), ''), p_usuario_id, now())
    ON CONFLICT (negocio_id, ejercicio) DO UPDATE SET desde = EXCLUDED.desde, hasta = EXCLUDED.hasta, costo_ventas_ves = EXCLUDED.costo_ventas_ves, gastos_ves = EXCLUDED.gastos_ves,
        otras_deducciones_ves = EXCLUDED.otras_deducciones_ves, ajuste_inflacion_ves = EXCLUDED.ajuste_inflacion_ves, rebajas_ves = EXCLUDED.rebajas_ves,
        notas = EXCLUDED.notas, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = EXCLUDED.actualizado_en;
END $$;

-- Reemplaza los tramos de un ejercicio. p_tramos = [{desde_ut, hasta_ut, pct, sustraendo_ut}, ...]: el primero parte de 0, cada uno empieza donde termina el anterior y el último no tiene tope.
CREATE OR REPLACE FUNCTION fn_islr_tramos_guardar(p_ejercicio int, p_tramos jsonb) RETURNS int LANGUAGE plpgsql AS $$
DECLARE t record; prev_hasta numeric := 0; n int := 0; total int;
BEGIN
    IF p_ejercicio IS NULL OR p_ejercicio NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'El ejercicio no es válido' USING ERRCODE = 'TV006'; END IF;
    IF p_tramos IS NULL OR jsonb_typeof(p_tramos) <> 'array' THEN RAISE EXCEPTION 'Faltan los tramos' USING ERRCODE = 'TV006'; END IF;
    total := jsonb_array_length(p_tramos);
    DELETE FROM islr_tarifa_tramos WHERE negocio_id = fn_negocio_actual() AND ejercicio = p_ejercicio;
    IF total = 0 THEN RETURN 0; END IF;
    FOR t IN SELECT (e->>'desde_ut')::numeric AS d, NULLIF(e->>'hasta_ut', '')::numeric AS h, (e->>'pct')::numeric AS p, COALESCE(NULLIF(e->>'sustraendo_ut', '')::numeric, 0) AS s, i
               FROM jsonb_array_elements(p_tramos) WITH ORDINALITY AS x(e, i) ORDER BY (e->>'desde_ut')::numeric
    LOOP
        n := n + 1;
        IF t.d IS DISTINCT FROM prev_hasta THEN RAISE EXCEPTION 'Tramo %: debe empezar en % UT (donde termina el anterior)', n, prev_hasta USING ERRCODE = 'TV006'; END IF;
        IF t.h IS NULL AND n < total THEN RAISE EXCEPTION 'Tramo %: solo el último tramo puede quedar sin tope', n USING ERRCODE = 'TV006'; END IF;
        IF t.h IS NOT NULL AND t.h <= t.d THEN RAISE EXCEPTION 'Tramo %: el tope debe ser mayor que el inicio', n USING ERRCODE = 'TV006'; END IF;
        IF t.p IS NULL OR t.p < 0 OR t.p > 100 THEN RAISE EXCEPTION 'Tramo %: el porcentaje debe estar entre 0 y 100', n USING ERRCODE = 'TV006'; END IF;
        IF t.s < 0 THEN RAISE EXCEPTION 'Tramo %: el sustraendo no puede ser negativo', n USING ERRCODE = 'TV006'; END IF;
        INSERT INTO islr_tarifa_tramos (negocio_id, ejercicio, desde_ut, hasta_ut, pct, sustraendo_ut) VALUES (fn_negocio_actual(), p_ejercicio, t.d, t.h, t.p, t.s);
        prev_hasta := t.h;
    END LOOP;
    IF prev_hasta IS NOT NULL THEN RAISE EXCEPTION 'El último tramo debe quedar sin tope (hasta vacío)' USING ERRCODE = 'TV006'; END IF;
    RETURN n;
END $$;

-- ── Borrador de la declaración del ejercicio ─────────────────────────────────
CREATE OR REPLACE FUNCTION fn_islr_borrador(p_ejercicio int) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    d islr_declaracion; v_desde date; v_hasta date; v_ut numeric; hoy date := fn_hoy();
    ingresos numeric; n_docs int; costo_sis numeric; costo numeric; manual boolean;
    gastos numeric := 0; otras numeric := 0; ajuste numeric := 0; rebajas numeric := 0;
    renta_bruta numeric; renta_neta numeric; renta_ut numeric; tr islr_tarifa_tramos; n_tramos int;
    impuesto numeric; imp_neto numeric; sufridas numeric; anticipos numeric; saldo numeric;
    prac numeric; prac_pend numeric; avisos jsonb := '[]'::jsonb;
BEGIN
    SELECT * INTO d FROM islr_declaracion WHERE negocio_id = fn_negocio_actual() AND ejercicio = p_ejercicio;
    v_desde := COALESCE(d.desde, make_date(p_ejercicio, 1, 1));
    v_hasta := COALESCE(d.hasta, make_date(p_ejercicio, 12, 31));
    IF d.ejercicio IS NOT NULL THEN gastos := d.gastos_ves; otras := d.otras_deducciones_ves; ajuste := d.ajuste_inflacion_ves; rebajas := d.rebajas_ves; END IF;
    v_ut := fn_islr_ut(v_hasta);

    SELECT COALESCE(sum(base_imponible_ves + exento_ves + exonerado_ves), 0), count(*) INTO ingresos, n_docs
      FROM v_libro_ventas WHERE id_negocio = fn_negocio_actual() AND estado <> 'ANULADA' AND fecha BETWEEN v_desde AND v_hasta;

    SELECT COALESCE(sum(ROUND(dv.cantidad * dv.costo_unitario_usd, 2) * v.tasa_cambio), 0) INTO costo_sis
      FROM detalle_venta dv JOIN ventas v ON v.id = dv.venta_id
     WHERE v.negocio_id = fn_negocio_actual() AND v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN v_desde AND v_hasta;
    costo_sis := round(costo_sis, 2);
    manual := d.costo_ventas_ves IS NOT NULL;
    costo := COALESCE(d.costo_ventas_ves, costo_sis);

    renta_bruta := ingresos - costo;
    renta_neta  := renta_bruta - gastos - otras + ajuste;

    SELECT count(*) INTO n_tramos FROM islr_tarifa_tramos WHERE negocio_id = fn_negocio_actual() AND ejercicio = p_ejercicio;
    impuesto := NULL;
    IF renta_neta <= 0 THEN impuesto := 0;
    ELSIF v_ut IS NOT NULL AND n_tramos > 0 THEN
        renta_ut := renta_neta / v_ut;
        SELECT * INTO tr FROM islr_tarifa_tramos WHERE negocio_id = fn_negocio_actual() AND ejercicio = p_ejercicio AND desde_ut < renta_ut AND (hasta_ut IS NULL OR renta_ut <= hasta_ut) ORDER BY desde_ut LIMIT 1;
        IF tr.ejercicio IS NOT NULL THEN impuesto := round(GREATEST(renta_ut * tr.pct / 100 - tr.sustraendo_ut, 0) * v_ut, 2); END IF;
    END IF;
    imp_neto := CASE WHEN impuesto IS NULL THEN NULL ELSE GREATEST(impuesto - rebajas, 0) END;

    SELECT COALESCE(sum(retenido_ves), 0) INTO sufridas FROM islr_retenciones_sufridas WHERE negocio_id = fn_negocio_actual() AND estado = 'ACTIVO' AND fecha BETWEEN v_desde AND v_hasta;
    SELECT COALESCE(sum(monto_ves), 0)    INTO anticipos FROM islr_anticipos WHERE negocio_id = fn_negocio_actual() AND estado = 'ACTIVO' AND fecha_pago BETWEEN v_desde AND v_hasta;
    saldo := CASE WHEN imp_neto IS NULL THEN NULL ELSE imp_neto - sufridas - anticipos END;

    SELECT COALESCE(sum(retenido_ves), 0), COALESCE(sum(retenido_ves) FILTER (WHERE entero_id IS NULL), 0) INTO prac, prac_pend
      FROM retenciones_islr WHERE negocio_id = fn_negocio_actual() AND estado = 'ACTIVA' AND fecha BETWEEN v_desde AND v_hasta;

    IF v_hasta >= hoy THEN avisos := avisos || to_jsonb('El ejercicio aún no termina (cierra el ' || to_char(v_hasta, 'DD/MM/YYYY') || '): las cifras son parciales.'::text); END IF;
    IF v_ut IS NULL THEN avisos := avisos || to_jsonb('Falta registrar la unidad tributaria vigente al cierre del ejercicio (Retenciones de ISLR → Parámetros).'::text); END IF;
    IF n_tramos = 0 THEN avisos := avisos || to_jsonb('Faltan los tramos de la tarifa del ejercicio: pídeselos a tu contador y cárgalos para calcular el impuesto.'::text); END IF;
    IF NOT manual THEN avisos := avisos || to_jsonb('El costo de lo vendido es el costo congelado en cada venta (no descuenta devoluciones ni ajusta inventario). Tu contador puede reemplazarlo con su cifra.'::text); END IF;
    IF d.ejercicio IS NULL THEN avisos := avisos || to_jsonb('Aún no hay gastos, deducciones, ajuste por inflación ni rebajas del ejercicio: los aporta tu contador.'::text); END IF;
    IF renta_neta <= 0 THEN avisos := avisos || to_jsonb('El resultado es una pérdida o cero: las personas jurídicas deben declarar igualmente.'::text); END IF;
    IF prac_pend > 0 THEN avisos := avisos || to_jsonb('Tienes retenciones de ISLR practicadas a proveedores sin enterar (Bs ' || to_char(prac_pend, 'FM999G999G990D00') || ').'::text); END IF;

    RETURN jsonb_build_object(
        'ejercicio', p_ejercicio, 'desde', v_desde, 'hasta', v_hasta, 'ut', v_ut, 'configurado', d.ejercicio IS NOT NULL,
        'ingresos', ingresos, 'documentos', n_docs, 'costo_sistema', costo_sis, 'costo', costo, 'costo_manual', manual, 'renta_bruta', renta_bruta,
        'gastos', gastos, 'otras_deducciones', otras, 'ajuste_inflacion', ajuste, 'renta_neta', renta_neta,
        'renta_neta_ut', CASE WHEN v_ut IS NOT NULL THEN round(renta_neta / v_ut, 2) END,
        'tramo', CASE WHEN tr.ejercicio IS NOT NULL THEN jsonb_build_object('desde_ut', tr.desde_ut, 'hasta_ut', tr.hasta_ut, 'pct', tr.pct, 'sustraendo_ut', tr.sustraendo_ut) END,
        'impuesto', impuesto, 'rebajas', rebajas, 'impuesto_neto', imp_neto, 'retenciones_sufridas', sufridas, 'anticipos', anticipos, 'saldo', saldo,
        'retenido_practicado', prac, 'retenido_por_enterar', prac_pend, 'notas', d.notas, 'avisos', avisos);
END $$;
COMMENT ON FUNCTION fn_islr_borrador(int) IS 'Borrador de la declaración del ejercicio: ingresos del libro de ventas, costo congelado, cifras del contador, tarifa por tramos, retenciones soportadas y anticipos. No es el formulario del SENIAT.';

-- ── Alertas de ISLR (las usa el comando artisan islr:alertas y la pantalla) ──
CREATE OR REPLACE FUNCTION fn_islr_alertas(p_hoy date DEFAULT NULL, p_dias int DEFAULT 7)
RETURNS TABLE (tipo text, gravedad text, mensaje text, fecha date)
LANGUAGE plpgsql STABLE AS $$
DECLARE hoy date := COALESCE(p_hoy, fn_hoy()); pend numeric; pend_n int; mas_antigua date; v record;
BEGIN
    SELECT COALESCE(sum(retenido_ves), 0), count(*), min(r.fecha) INTO pend, pend_n, mas_antigua FROM retenciones_islr r WHERE r.negocio_id = fn_negocio_actual() AND estado = 'ACTIVA' AND entero_id IS NULL;
    FOR v IN SELECT * FROM fn_proximos_vencimientos(hoy, 60) x WHERE x.obligacion LIKE 'ISLR%' AND NOT x.presentada AND x.dias <= p_dias ORDER BY x.fecha_limite
    LOOP
        tipo := 'VENCIMIENTO'; fecha := v.fecha_limite;
        gravedad := CASE WHEN v.dias < 0 THEN 'VENCIDO' ELSE 'PRONTO' END;
        mensaje := v.titulo || CASE WHEN v.dias < 0 THEN ' venció el ' ELSE ' vence el ' END || to_char(v.fecha_limite, 'DD/MM/YYYY') || CASE WHEN v.obligacion = 'ISLR_ENTERO' AND pend_n > 0 THEN ' (hay ' || pend_n || ' retenciones por enterar)' ELSE '' END;
        RETURN NEXT;
    END LOOP;
    IF pend_n > 0 AND NOT EXISTS (SELECT 1 FROM calendario_fiscal c WHERE c.negocio_id = fn_negocio_actual() AND c.obligacion = 'ISLR_ENTERO' AND c.digito = fn_digito_rif_negocio() AND c.regimen = fn_regimen_calendario()) THEN
        tipo := 'POR_ENTERAR'; gravedad := 'AVISO'; fecha := mas_antigua;
        mensaje := 'Hay ' || pend_n || ' retenciones de ISLR por enterar desde el ' || to_char(mas_antigua, 'DD/MM/YYYY') || ' (no hay fecha de entero cargada en el calendario).';
        RETURN NEXT;
    END IF;
END $$;

-- ── Multiinquilino: sello, RLS y permisos (mismo patrón que 31) ──────────────
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['islr_anticipos','islr_retenciones_sufridas','islr_declaracion','islr_tarifa_tramos'] LOOP
        EXECUTE format('CREATE INDEX IF NOT EXISTS ix_%s_negocio ON tienda.%I (negocio_id)', t, t);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_sello_negocio ON tienda.%I', t);
        EXECUTE format('CREATE TRIGGER trg_sello_negocio BEFORE INSERT ON tienda.%I FOR EACH ROW EXECUTE FUNCTION fn_sello_negocio()', t);
        EXECUTE format('ALTER TABLE tienda.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE tienda.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS p_tenant ON tienda.%I', t);
        EXECUTE format($p$CREATE POLICY p_tenant ON tienda.%I
            USING (negocio_id = fn_negocio_actual() AND (SELECT fn_sesion_permitida()))
            WITH CHECK (negocio_id = fn_negocio_actual() AND (SELECT fn_sesion_permitida()))$p$, t);
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saas_app') THEN
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON tienda.%I TO saas_app', t);
        END IF;
    END LOOP;
END $$;
