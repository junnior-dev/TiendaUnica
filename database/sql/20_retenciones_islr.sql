-- =============================================================================
--  20 · Retenciones de ISLR a proveedores (Decreto 1.808, retenciones del impuesto sobre la renta)
-- =============================================================================
--  Requiere: 10 y 19 (cuentas y parámetros). Es idempotente:
--     psql -d tienda -v ON_ERROR_STOP=1 -f 20_retenciones_islr.sql
--
--  Qué cubre: cuando el negocio PAGA un servicio (honorarios, comisiones, fletes, alquileres, contratistas) debe retener una parte
--  del ISLR del beneficiario y enterarla al SENIAT. La compra de MERCANCÍA no está en la tabla de retenciones: no se retiene.
--
--  Cálculo (por pago):
--     Persona jurídica domiciliada : base × porcentaje.
--     Persona natural residente    : base × porcentaje − sustraendo,  sustraendo = UT × porcentaje × 83,3334.
--     Si el resultado no es mayor que cero, no corresponde retención (el pago no supera el mínimo de 83,3334 UT).
--  La unidad tributaria (UT) cambia: se registra con su fecha de vigencia y NO viene cargada. Los porcentajes del catálogo son los de
--  la tabla del Decreto; confírmalos con tu contador. Si tu contador aplica el sustraendo una sola vez al mes por beneficiario y
--  concepto, activa esa opción (islr_config.sustraendo_una_vez_mes).
--
--  Cada retención guarda su comprobante numerado (AAAAMM + 8 dígitos), el asiento contable (gasto / fondos / ISLR retenido por pagar)
--  y se marca como enterada cuando se paga al SENIAT (asiento: ISLR retenido por pagar / Bancos). No se borra ni se edita: se anula.
--  Este módulo registra la base SIN IVA. El IVA de la factura del servicio, si lo hay, va por Compras o con tu contador.
-- =============================================================================
SET search_path = tienda, public;

CREATE TABLE IF NOT EXISTS islr_conceptos (
    codigo          varchar(30) PRIMARY KEY,
    nombre          varchar(80) NOT NULL,
    pct_natural     numeric(5,2) NOT NULL CHECK (pct_natural BETWEEN 0 AND 100),
    pct_juridica    numeric(5,2) NOT NULL CHECK (pct_juridica BETWEEN 0 AND 100),
    sustraendo_nat  boolean NOT NULL DEFAULT true,
    activo          boolean NOT NULL DEFAULT true,
    orden           smallint NOT NULL DEFAULT 0
);
COMMENT ON TABLE islr_conceptos IS 'Conceptos de pago sujetos a retención de ISLR y su porcentaje por tipo de beneficiario (Decreto 1.808). Confírmalos con tu contador.';
INSERT INTO islr_conceptos (codigo, nombre, pct_natural, pct_juridica, sustraendo_nat, orden) VALUES
    ('HONORARIOS',         'Honorarios profesionales',          3, 5, true, 1),
    ('COMISIONES',         'Comisiones mercantiles',            3, 5, true, 2),
    ('CONTRATISTAS',       'Contratistas y subcontratistas',    1, 2, true, 3),
    ('ALQUILER_INMUEBLES', 'Alquiler de inmuebles',             3, 5, true, 4),
    ('ALQUILER_MUEBLES',   'Alquiler de bienes muebles',        3, 5, true, 5),
    ('FLETES',             'Fletes y transporte',               3, 3, true, 6)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS islr_ut (
    desde       date PRIMARY KEY,
    valor_ves   numeric(14,4) NOT NULL CHECK (valor_ves > 0),
    nota        varchar(120),
    usuario_id  bigint REFERENCES usuarios(id),
    created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE islr_ut IS 'Unidad tributaria en bolívares y desde qué fecha rige. La retención usa la vigente en la fecha del pago.';

CREATE TABLE IF NOT EXISTS islr_config (
    id                      smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    sustraendo_una_vez_mes  boolean NOT NULL DEFAULT false,
    factor_sustraendo       numeric(8,4) NOT NULL DEFAULT 83.3334 CHECK (factor_sustraendo > 0)
);
INSERT INTO islr_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS enteros_islr (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    desde       date NOT NULL,
    hasta       date NOT NULL,
    fecha_pago  date NOT NULL,
    referencia  varchar(60),
    monto_ves   numeric(18,2) NOT NULL CHECK (monto_ves > 0),
    estado      varchar(7) NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','ANULADO')),
    usuario_id  bigint REFERENCES usuarios(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    anulado_en  timestamptz,
    motivo_anulacion text
);

CREATE TABLE IF NOT EXISTS retenciones_islr (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero           varchar(14) NOT NULL,
    fecha            date NOT NULL,
    proveedor_id     bigint REFERENCES proveedores(id),
    beneficiario     varchar(150) NOT NULL,
    rif              varchar(15)  NOT NULL,
    tipo_beneficiario char(1) NOT NULL CHECK (tipo_beneficiario IN ('N','J')),
    concepto         varchar(30) NOT NULL REFERENCES islr_conceptos(codigo),
    documento        varchar(40),
    moneda           char(3) NOT NULL REFERENCES monedas(codigo),
    monto_orig       numeric(18,2) NOT NULL CHECK (monto_orig > 0),
    tasa_ves         numeric(18,6) NOT NULL CHECK (tasa_ves > 0),
    base_ves         numeric(18,2) NOT NULL CHECK (base_ves > 0),
    porcentaje       numeric(5,2)  NOT NULL,
    ut_ves           numeric(14,4),
    sustraendo_ves   numeric(18,2) NOT NULL DEFAULT 0 CHECK (sustraendo_ves >= 0),
    retenido_ves     numeric(18,2) NOT NULL CHECK (retenido_ves > 0),
    neto_pagado_ves  numeric(18,2) NOT NULL CHECK (neto_pagado_ves >= 0),
    fondos           varchar(6) NOT NULL CHECK (fondos IN ('CAJA','BANCOS')),
    observaciones    text,
    estado           varchar(7) NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA','ANULADA')),
    entero_id        bigint REFERENCES enteros_islr(id),
    usuario_id       bigint REFERENCES usuarios(id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    anulada_en       timestamptz,
    motivo_anulacion text
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_retencion_islr_numero ON retenciones_islr (numero);
CREATE INDEX IF NOT EXISTS ix_retencion_islr_fecha ON retenciones_islr (fecha);
CREATE INDEX IF NOT EXISTS ix_retencion_islr_benef ON retenciones_islr (rif, concepto, fecha) WHERE estado = 'ACTIVA';

-- Guardia: solo se anula, o se marca/desmarca como enterada. Nada más cambia.
CREATE OR REPLACE FUNCTION trg_retenciones_islr_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o jsonb; n jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Una retención no se borra: anúlala' USING ERRCODE = 'TV005'; END IF;
    o := to_jsonb(OLD) - 'estado' - 'anulada_en' - 'motivo_anulacion' - 'entero_id';
    n := to_jsonb(NEW) - 'estado' - 'anulada_en' - 'motivo_anulacion' - 'entero_id';
    IF o <> n THEN RAISE EXCEPTION 'Una retención no se modifica: anúlala y regístrala de nuevo' USING ERRCODE = 'TV005'; END IF;
    IF OLD.estado = 'ANULADA' THEN RAISE EXCEPTION 'La retención ya está anulada' USING ERRCODE = 'TV005'; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_retenciones_islr_guardia ON retenciones_islr;
CREATE TRIGGER trg_retenciones_islr_guardia BEFORE UPDATE OR DELETE ON retenciones_islr FOR EACH ROW EXECUTE FUNCTION trg_retenciones_islr_guardia();

-- UT vigente en una fecha (NULL si no hay ninguna cargada a esa fecha).
CREATE OR REPLACE FUNCTION fn_islr_ut(p_fecha date) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT valor_ves FROM islr_ut WHERE desde <= p_fecha ORDER BY desde DESC LIMIT 1
$$;

-- Cálculo puro (sin guardar): lo usan la vista previa de la pantalla y el registro, para que den siempre lo mismo.
CREATE OR REPLACE FUNCTION fn_islr_calcular(p_fecha date, p_tipo char, p_concepto text, p_base_ves numeric, p_rif text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE c islr_conceptos; cfg islr_config; pct numeric; ut numeric; sus numeric := 0; ret numeric; previa boolean := false;
BEGIN
    SELECT * INTO c FROM islr_conceptos WHERE codigo = p_concepto AND activo;
    IF c.codigo IS NULL THEN RAISE EXCEPTION 'Elige el concepto del pago' USING ERRCODE = 'TV006'; END IF;
    IF p_tipo NOT IN ('N','J') THEN RAISE EXCEPTION 'Indica si el beneficiario es persona natural o jurídica' USING ERRCODE = 'TV006'; END IF;
    IF p_base_ves IS NULL OR p_base_ves <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO cfg FROM islr_config WHERE id = fn_negocio_actual();
    pct := CASE WHEN p_tipo = 'N' THEN c.pct_natural ELSE c.pct_juridica END;
    IF p_tipo = 'N' AND c.sustraendo_nat THEN
        ut := fn_islr_ut(p_fecha);
        IF ut IS NULL THEN RAISE EXCEPTION 'Para una persona natural falta la unidad tributaria vigente al %: regístrala en «Parámetros de ISLR»', to_char(p_fecha, 'DD/MM/YYYY') USING ERRCODE = 'TV006'; END IF;
        sus := ROUND(ut * pct / 100 * cfg.factor_sustraendo, 2);
        IF cfg.sustraendo_una_vez_mes AND p_rif IS NOT NULL AND EXISTS (
               SELECT 1 FROM retenciones_islr r WHERE r.estado = 'ACTIVA' AND r.rif = upper(replace(p_rif, '-', '')) AND r.concepto = p_concepto
                  AND date_trunc('month', r.fecha) = date_trunc('month', p_fecha) AND r.sustraendo_ves > 0) THEN
            sus := 0; previa := true;
        END IF;
    END IF;
    ret := ROUND(p_base_ves * pct / 100, 2) - sus;
    RETURN jsonb_build_object('porcentaje', pct, 'ut', ut, 'sustraendo', sus, 'sustraendo_ya_aplicado_en_el_mes', previa,
        'retenido', GREATEST(ret, 0), 'corresponde', ret > 0, 'neto', p_base_ves - GREATEST(ret, 0), 'concepto', c.nombre);
END $$;

-- Registra la retención (y, con contabilidad automática, su asiento). Devuelve el id.
CREATE OR REPLACE FUNCTION fn_registrar_retencion_islr(
    p_fecha date, p_beneficiario text, p_rif text, p_tipo char, p_concepto text, p_documento text,
    p_monto numeric, p_moneda char, p_fondos text, p_proveedor_id bigint, p_observaciones text, p_usuario_id bigint)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE rif_n text; t numeric; base numeric; calc jsonb; v_id bigint; v_num text; seq int; mes text; lineas jsonb; ret numeric; neto numeric;
BEGIN
    IF p_fecha IS NULL OR p_fecha > fn_hoy() THEN RAISE EXCEPTION 'La fecha del pago no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF p_beneficiario IS NULL OR length(trim(p_beneficiario)) < 3 THEN RAISE EXCEPTION 'Escribe el nombre del beneficiario' USING ERRCODE = 'TV006'; END IF;
    IF NOT fn_validar_rif(p_rif) THEN RAISE EXCEPTION 'El RIF del beneficiario no es válido' USING ERRCODE = 'TV006'; END IF;
    IF p_fondos NOT IN ('CAJA','BANCOS') THEN RAISE EXCEPTION 'Indica si el pago salió de caja o de bancos' USING ERRCODE = 'TV006'; END IF;
    IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    rif_n := upper(replace(p_rif, '-', ''));
    IF p_tipo = 'N' AND left(rif_n, 1) NOT IN ('V','E','P') THEN RAISE EXCEPTION 'Una persona natural tiene RIF que empieza por V, E o P' USING ERRCODE = 'TV006'; END IF;
    IF p_tipo = 'J' AND left(rif_n, 1) NOT IN ('J','G','C') THEN RAISE EXCEPTION 'Una persona jurídica tiene RIF que empieza por J, G o C' USING ERRCODE = 'TV006'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('tienda.islr.' || to_char(p_fecha, 'YYYYMM')));
    t := CASE WHEN p_moneda = 'VES' THEN 1 ELSE fn_tasa_par(p_moneda, 'VES', p_fecha) END;
    IF t IS NULL OR t <= 0 THEN RAISE EXCEPTION 'No hay tasa para % el %: cárgala en Tasas de cambio', trim(p_moneda), to_char(p_fecha, 'DD/MM/YYYY') USING ERRCODE = 'TV006'; END IF;
    base := ROUND(p_monto * t, 2);
    calc := fn_islr_calcular(p_fecha, p_tipo, p_concepto, base, rif_n);
    IF NOT (calc->>'corresponde')::boolean THEN
        RAISE EXCEPTION 'No corresponde retener: el monto no supera el mínimo sujeto a retención (sustraendo Bs %)', to_char((calc->>'sustraendo')::numeric, 'FM999G999G990D00') USING ERRCODE = 'TV005';
    END IF;
    ret := (calc->>'retenido')::numeric; neto := base - ret;
    mes := to_char(p_fecha, 'YYYYMM');
    SELECT COALESCE(max(substr(numero, 7)::int), 0) + 1 INTO seq FROM retenciones_islr WHERE numero LIKE mes || '%';
    v_num := mes || lpad(seq::text, 8, '0');
    INSERT INTO retenciones_islr (numero, fecha, proveedor_id, beneficiario, rif, tipo_beneficiario, concepto, documento, moneda, monto_orig, tasa_ves, base_ves,
                                  porcentaje, ut_ves, sustraendo_ves, retenido_ves, neto_pagado_ves, fondos, observaciones, usuario_id)
    VALUES (v_num, p_fecha, p_proveedor_id, trim(p_beneficiario), rif_n, p_tipo, p_concepto, NULLIF(trim(p_documento), ''), p_moneda, ROUND(p_monto, 2), t, base,
            (calc->>'porcentaje')::numeric, (calc->>'ut')::numeric, (calc->>'sustraendo')::numeric, ret, neto, p_fondos, NULLIF(trim(p_observaciones), ''), p_usuario_id)
    RETURNING id INTO v_id;
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN
        lineas := jsonb_build_array(
            jsonb_build_object('cuenta_id', fn_cuenta_param('GASTOS_GENERALES'), 'debe', base, 'glosa', (calc->>'concepto') || ' · ' || trim(p_beneficiario)),
            jsonb_build_object('cuenta_id', fn_cuenta_param('ISLR_POR_PAGAR'), 'haber', ret, 'glosa', 'ISLR retenido ' || v_num));
        IF neto > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param(p_fondos), 'haber', neto, 'glosa', 'Pago neto de la retención ' || v_num); END IF;
        PERFORM fn_crear_asiento(p_fecha, 'Retención de ISLR ' || v_num || ' · ' || trim(p_beneficiario), 'RETENCION_ISLR', v_id, lineas, p_usuario_id);
    END IF;
    RETURN v_id;
END $$;

-- Anula una retención que todavía no se enteró (contra-asiento si tenía asiento).
CREATE OR REPLACE FUNCTION fn_anular_retencion_islr(p_id bigint, p_motivo text, p_usuario_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r retenciones_islr;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO r FROM retenciones_islr WHERE id = p_id FOR UPDATE;
    IF r.id IS NULL THEN RAISE EXCEPTION 'La retención no existe' USING ERRCODE = 'TV006'; END IF;
    IF r.estado = 'ANULADA' THEN RAISE EXCEPTION 'La retención ya está anulada' USING ERRCODE = 'TV006'; END IF;
    IF r.entero_id IS NOT NULL THEN RAISE EXCEPTION 'Esa retención ya se enteró al SENIAT: primero desmarca el pago' USING ERRCODE = 'TV005'; END IF;
    PERFORM fn_contra_asiento('RETENCION_ISLR', p_id, 'ANULACION_RETENCION_ISLR', fn_hoy(), 'Anulación de la retención de ISLR ' || r.numero, p_usuario_id);
    UPDATE retenciones_islr SET estado = 'ANULADA', anulada_en = now(), motivo_anulacion = trim(p_motivo) WHERE id = p_id;
END $$;

-- Marca como enteradas las retenciones activas de un rango de fechas y registra el pago al SENIAT (Debe ISLR por pagar / Haber Bancos).
CREATE OR REPLACE FUNCTION fn_enterar_islr(p_desde date, p_hasta date, p_fecha_pago date, p_referencia text, p_usuario_id bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE total numeric; con_asiento numeric; v_id bigint; lineas jsonb;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('tienda.islr.entero'));
    IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN RAISE EXCEPTION 'Elige el período a enterar' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha_pago IS NULL OR p_fecha_pago > fn_hoy() THEN RAISE EXCEPTION 'La fecha de pago no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha_pago < p_hasta THEN RAISE EXCEPTION 'El pago no puede ser anterior a la última retención del período' USING ERRCODE = 'TV006'; END IF;
    SELECT COALESCE(sum(retenido_ves), 0) INTO total FROM retenciones_islr WHERE estado = 'ACTIVA' AND entero_id IS NULL AND fecha BETWEEN p_desde AND p_hasta;
    IF total <= 0 THEN RAISE EXCEPTION 'No hay retenciones de ISLR por enterar en ese período' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO enteros_islr (desde, hasta, fecha_pago, referencia, monto_ves, usuario_id)
    VALUES (p_desde, p_hasta, p_fecha_pago, NULLIF(trim(p_referencia), ''), total, p_usuario_id) RETURNING id INTO v_id;
    UPDATE retenciones_islr SET entero_id = v_id WHERE estado = 'ACTIVA' AND entero_id IS NULL AND fecha BETWEEN p_desde AND p_hasta;
    -- Solo las retenciones que acreditaron 2.1.04 (las anteriores a la contabilidad automática no tienen asiento) se debitan.
    SELECT COALESCE(sum(r.retenido_ves), 0) INTO con_asiento FROM retenciones_islr r
     WHERE r.entero_id = v_id AND EXISTS (SELECT 1 FROM asientos a WHERE a.origen_tipo = 'RETENCION_ISLR' AND a.origen_id = r.id);
    IF con_asiento > 0 THEN
        lineas := jsonb_build_array(
            jsonb_build_object('cuenta_id', fn_cuenta_param('ISLR_POR_PAGAR'), 'debe', con_asiento, 'glosa', 'ISLR enterado'),
            jsonb_build_object('cuenta_id', fn_cuenta_param('BANCOS'), 'haber', con_asiento, 'glosa', 'Pago al SENIAT ' || COALESCE(NULLIF(trim(p_referencia), ''), '')));
        PERFORM fn_crear_asiento(p_fecha_pago, 'Pago al SENIAT de ISLR retenido (' || to_char(p_desde, 'DD/MM') || ' al ' || to_char(p_hasta, 'DD/MM/YYYY') || ')', 'ENTERO_ISLR', v_id, lineas, p_usuario_id);
    END IF;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION fn_desmarcar_entero_islr(p_id bigint, p_motivo text, p_usuario_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e enteros_islr;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Escribe el motivo' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO e FROM enteros_islr WHERE id = p_id FOR UPDATE;
    IF e.id IS NULL OR e.estado = 'ANULADO' THEN RAISE EXCEPTION 'Ese pago no existe o ya fue desmarcado' USING ERRCODE = 'TV006'; END IF;
    PERFORM fn_contra_asiento('ENTERO_ISLR', p_id, 'ANULACION_ENTERO_ISLR', fn_hoy(), 'Anulación del pago de ISLR al SENIAT del ' || to_char(e.fecha_pago, 'DD/MM/YYYY'), p_usuario_id);
    UPDATE retenciones_islr SET entero_id = NULL WHERE entero_id = p_id;
    UPDATE enteros_islr SET estado = 'ANULADO', anulado_en = now(), motivo_anulacion = trim(p_motivo) WHERE id = p_id;
END $$;

-- La UT solo se agrega (con su fecha), no se pisa: así cada retención pudo usar la UT que regía ese día.
CREATE OR REPLACE FUNCTION fn_islr_guardar_ut(p_desde date, p_valor numeric, p_nota text, p_usuario_id bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'La unidad tributaria debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF p_desde IS NULL OR p_desde > fn_hoy() THEN RAISE EXCEPTION 'La fecha de vigencia no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    IF EXISTS (SELECT 1 FROM retenciones_islr WHERE estado = 'ACTIVA' AND fecha >= p_desde) THEN
        RAISE EXCEPTION 'Ya hay retenciones desde esa fecha: elige una vigencia posterior a la última retención' USING ERRCODE = 'TV005';
    END IF;
    INSERT INTO islr_ut (desde, valor_ves, nota, usuario_id) VALUES (p_desde, p_valor, NULLIF(trim(p_nota), ''), p_usuario_id)
    ON CONFLICT (desde) DO UPDATE SET valor_ves = EXCLUDED.valor_ves, nota = EXCLUDED.nota, usuario_id = EXCLUDED.usuario_id;
END $$;
