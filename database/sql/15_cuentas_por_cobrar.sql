-- =============================================================================
--  15 · Cuentas por cobrar a clientes, venta a crédito y movimientos de caja
-- =============================================================================
--  Requiere: 14_aperturas_caja.sql (y el 10 y el 11 si usas contabilidad automática).
--  Qué agrega
--    · Venta a crédito: fn_registrar_venta acepta pagos parciales (o ninguno) SOLO si p_es_credito = true y hay cliente.
--      La parte sin pagar nace como cuenta por cobrar (cuentas_por_cobrar). Con es_credito = false sigue exigiéndose pagado = total.
--    · Cobranza: fn_registrar_pago_cobrar / fn_anular_pago_cobrar (pagos_cobrar), multimoneda con tasa congelada del día del cobro.
--    · Movimientos de caja manuales (flete, retiro…) y los que generan los cobros: movimientos_caja.
--    · fn_resumen_apertura: todas las cifras del turno para el Corte X / Z (efectivo esperado por moneda).
--    · Contabilidad: cuenta 1.1.06 «Cuentas por cobrar a clientes» (parámetro CUENTAS_POR_COBRAR); asientos de la venta a crédito y de los cobros.
--     psql -d tienda -f 15_cuentas_por_cobrar.sql        (es idempotente)
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  1. ventas: marca de crédito y saldo de consulta rápida
-- ---------------------------------------------------------------------------
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS es_credito boolean NOT NULL DEFAULT false;
ALTER TABLE ventas ADD COLUMN IF NOT EXISTS saldo_pendiente_usd numeric(18,2) NOT NULL DEFAULT 0 CHECK (saldo_pendiente_usd >= 0);
COMMENT ON COLUMN ventas.es_credito IS 'Venta a crédito: se permite pagar menos que el total; lo que falta queda en cuentas_por_cobrar. Se fija al crear la venta.';
COMMENT ON COLUMN ventas.saldo_pendiente_usd IS 'Copia de consulta rápida del saldo de la cuenta por cobrar (la fuente real es cuentas_por_cobrar; la mantiene un trigger).';

-- La cabecera de ventas es inmutable. Única excepción nueva: el saldo de consulta (lo mueve el trigger de cuentas_por_cobrar).
CREATE OR REPLACE FUNCTION fn_solo_cambia_saldo_credito(p_old ventas, p_new ventas) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n ventas := p_new;
BEGIN
    n.saldo_pendiente_usd := p_old.saldo_pendiente_usd;
    RETURN n IS NOT DISTINCT FROM p_old;
END $$;

CREATE OR REPLACE FUNCTION trg_guardia_cabecera() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'No se puede borrar un documento de % : anúlelo', TG_TABLE_NAME USING ERRCODE = 'TV005';
    END IF;
    IF OLD.creada_txid = pg_current_xact_id() THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'ventas' THEN
        IF fn_solo_asigna_factura_fiscal(OLD, NEW) OR fn_solo_cambio_estado_y_anulacion(OLD, NEW) OR fn_solo_cambia_saldo_credito(OLD, NEW) THEN RETURN NEW; END IF;
    ELSIF TG_TABLE_NAME = 'compras' THEN
        IF fn_solo_cambio_estado_y_anulacion(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'El documento de % no se puede modificar: solo puede anularse', TG_TABLE_NAME USING ERRCODE = 'TV005';
END $$;

-- ---------------------------------------------------------------------------
--  2. Tablas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cuentas_por_cobrar (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id          bigint        NOT NULL REFERENCES clientes(id),
    venta_id            bigint        REFERENCES ventas(id),
    monto_original_usd  numeric(18,2) NOT NULL CHECK (monto_original_usd > 0),
    monto_original_ves  numeric(18,2) NOT NULL CHECK (monto_original_ves >= 0),
    saldo_usd           numeric(18,2) NOT NULL CHECK (saldo_usd >= 0),
    saldo_ves           numeric(18,2) NOT NULL CHECK (saldo_ves >= 0),
    fecha_vencimiento   date          NOT NULL,
    estado              varchar(9)    NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','PAGADA','ANULADA')),
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    CHECK (saldo_usd <= monto_original_usd),
    CHECK (estado <> 'PAGADA' OR (saldo_usd = 0 AND saldo_ves = 0)),
    CHECK (estado <> 'PENDIENTE' OR saldo_usd > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cxc_venta ON cuentas_por_cobrar (venta_id) WHERE venta_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cxc_cliente ON cuentas_por_cobrar (cliente_id, estado);
CREATE INDEX IF NOT EXISTS ix_cxc_vence ON cuentas_por_cobrar (fecha_vencimiento) WHERE estado = 'PENDIENTE';
COMMENT ON TABLE cuentas_por_cobrar IS 'Lo que un cliente debe por una venta a crédito. Saldo en USD y en Bs (el Bs va a la tasa de la venta; los cobros lo reducen en proporción).';

CREATE TABLE IF NOT EXISTS pagos_cobrar (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cuenta_por_cobrar_id  bigint        NOT NULL REFERENCES cuentas_por_cobrar(id),
    fecha                 date          NOT NULL,
    moneda                char(3)       NOT NULL REFERENCES monedas(codigo),
    monto                 numeric(18,2) NOT NULL CHECK (monto > 0),
    tasa_usd              numeric(20,8) NOT NULL CHECK (tasa_usd > 0),
    tasa_ves              numeric(20,8) NOT NULL CHECK (tasa_ves > 0),
    monto_usd             numeric(18,2) NOT NULL CHECK (monto_usd > 0),
    monto_ves             numeric(18,2) NOT NULL CHECK (monto_ves > 0),
    aplicado_ves          numeric(18,2) NOT NULL DEFAULT 0,       -- cuánto bajó el saldo en Bs (a la tasa de la venta)
    es_efectivo           boolean       NOT NULL DEFAULT true,    -- sin referencia = efectivo (igual que en el POS)
    referencia            varchar(60),
    usuario_id            bigint        NOT NULL REFERENCES usuarios(id),
    estado                varchar(7)    NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','ANULADO')),
    anulado_en            timestamptz,
    anulado_por           bigint        REFERENCES usuarios(id),
    motivo_anulacion      text,
    created_at            timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pagos_cobrar_cuenta ON pagos_cobrar (cuenta_por_cobrar_id);
CREATE INDEX IF NOT EXISTS ix_pagos_cobrar_fecha ON pagos_cobrar (fecha);
COMMENT ON TABLE pagos_cobrar IS 'Cobros a clientes sobre una cuenta por cobrar. Inmutables salvo la anulación (ACTIVO → ANULADO). tasa_usd / tasa_ves: tasas congeladas del día del cobro.';

CREATE TABLE IF NOT EXISTS movimientos_caja (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    apertura_id      bigint        NOT NULL REFERENCES aperturas_caja(id),
    tipo             varchar(7)    NOT NULL CHECK (tipo IN ('INGRESO','EGRESO')),
    concepto         varchar(200)  NOT NULL CHECK (length(trim(concepto)) >= 3),
    monto            numeric(18,2) NOT NULL CHECK (monto > 0),
    moneda           char(3)       NOT NULL REFERENCES monedas(codigo),
    tasa_usd         numeric(20,8) NOT NULL CHECK (tasa_usd > 0),
    tasa_ves         numeric(20,8) NOT NULL CHECK (tasa_ves > 0),
    monto_usd        numeric(18,2) NOT NULL,
    monto_ves        numeric(18,2) NOT NULL,
    referencia       varchar(60),
    es_efectivo      boolean       NOT NULL DEFAULT true,           -- solo el efectivo mueve el efectivo esperado del turno
    origen           varchar(15)   NOT NULL DEFAULT 'MANUAL' CHECK (origen IN ('MANUAL','COBRO_CXC','ANULACION_COBRO')),
    pago_cobrar_id   bigint        REFERENCES pagos_cobrar(id),
    usuario_id       bigint        NOT NULL REFERENCES usuarios(id),
    estado           varchar(7)    NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','ANULADO')),
    anulado_en       timestamptz,
    anulado_por      bigint        REFERENCES usuarios(id),
    motivo_anulacion text,
    created_at       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mov_caja_apertura ON movimientos_caja (apertura_id);
CREATE INDEX IF NOT EXISTS ix_mov_caja_fecha ON movimientos_caja (created_at);
COMMENT ON TABLE movimientos_caja IS 'Entradas y salidas de caja que no son ventas: gastos, fletes, retiros, cobros de cuentas por cobrar. Se atan al turno abierto.';

-- Inmutabilidad: pagos_cobrar y movimientos_caja solo cambian al anularse; nunca se borran.
CREATE OR REPLACE FUNCTION trg_cobros_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n record;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'No se puede borrar un registro de %: anúlelo', TG_TABLE_NAME USING ERRCODE = 'TV005'; END IF;
    IF OLD.estado <> 'ACTIVO' OR NEW.estado <> 'ANULADO' THEN RAISE EXCEPTION 'Un registro de % solo puede pasar de ACTIVO a ANULADO', TG_TABLE_NAME USING ERRCODE = 'TV005'; END IF;
    IF TG_TABLE_NAME = 'pagos_cobrar' THEN
        IF (NEW.cuenta_por_cobrar_id, NEW.fecha, NEW.moneda, NEW.monto, NEW.monto_usd, NEW.monto_ves, NEW.aplicado_ves, NEW.usuario_id)
           IS DISTINCT FROM (OLD.cuenta_por_cobrar_id, OLD.fecha, OLD.moneda, OLD.monto, OLD.monto_usd, OLD.monto_ves, OLD.aplicado_ves, OLD.usuario_id) THEN
            RAISE EXCEPTION 'Del cobro solo se puede registrar la anulación' USING ERRCODE = 'TV005'; END IF;
    ELSE
        IF (NEW.apertura_id, NEW.tipo, NEW.concepto, NEW.monto, NEW.moneda, NEW.monto_usd, NEW.monto_ves, NEW.usuario_id)
           IS DISTINCT FROM (OLD.apertura_id, OLD.tipo, OLD.concepto, OLD.monto, OLD.moneda, OLD.monto_usd, OLD.monto_ves, OLD.usuario_id) THEN
            RAISE EXCEPTION 'Del movimiento solo se puede registrar la anulación' USING ERRCODE = 'TV005'; END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pagos_cobrar_guardia ON pagos_cobrar;
CREATE TRIGGER trg_pagos_cobrar_guardia BEFORE UPDATE OR DELETE ON pagos_cobrar FOR EACH ROW EXECUTE FUNCTION trg_cobros_guardia();
DROP TRIGGER IF EXISTS trg_mov_caja_guardia ON movimientos_caja;
CREATE TRIGGER trg_mov_caja_guardia BEFORE UPDATE OR DELETE ON movimientos_caja FOR EACH ROW EXECUTE FUNCTION trg_cobros_guardia();

-- Mantiene updated_at y la copia ventas.saldo_pendiente_usd.
CREATE OR REPLACE FUNCTION trg_cxc_sincronizar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.venta_id IS NOT NULL THEN UPDATE ventas SET saldo_pendiente_usd = NEW.saldo_usd WHERE id = NEW.venta_id; END IF;
    ELSE
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION trg_cxc_sincronizar_despues() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.venta_id IS NOT NULL AND NEW.saldo_usd IS DISTINCT FROM OLD.saldo_usd THEN
        UPDATE ventas SET saldo_pendiente_usd = NEW.saldo_usd WHERE id = NEW.venta_id;
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_cxc_antes ON cuentas_por_cobrar;
CREATE TRIGGER trg_cxc_antes BEFORE INSERT OR UPDATE ON cuentas_por_cobrar FOR EACH ROW EXECUTE FUNCTION trg_cxc_sincronizar();
DROP TRIGGER IF EXISTS trg_cxc_despues ON cuentas_por_cobrar;
CREATE TRIGGER trg_cxc_despues AFTER UPDATE ON cuentas_por_cobrar FOR EACH ROW EXECUTE FUNCTION trg_cxc_sincronizar_despues();

-- Anular una venta a crédito anula su cuenta por cobrar. Si ya tiene cobros activos, primero hay que anularlos (el dinero cobrado se devuelve).
CREATE OR REPLACE FUNCTION trg_cxc_venta_anulada() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c cuentas_por_cobrar;
BEGIN
    SELECT * INTO c FROM cuentas_por_cobrar WHERE venta_id = NEW.id FOR UPDATE;
    IF c.id IS NULL THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM pagos_cobrar WHERE cuenta_por_cobrar_id = c.id AND estado = 'ACTIVO') THEN
        RAISE EXCEPTION 'La venta % tiene cobros registrados. Anula primero esos cobros en Cuentas por cobrar.', NEW.numero USING ERRCODE = 'TV005';
    END IF;
    UPDATE cuentas_por_cobrar SET estado = 'ANULADA', saldo_usd = 0, saldo_ves = 0 WHERE id = c.id;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_cxc_venta_anulada ON ventas;
CREATE TRIGGER trg_cxc_venta_anulada AFTER UPDATE OF estado ON ventas
    FOR EACH ROW WHEN (OLD.estado = 'COMPLETADA' AND NEW.estado = 'ANULADA' AND OLD.es_credito) EXECUTE FUNCTION trg_cxc_venta_anulada();

CREATE OR REPLACE VIEW v_cuentas_por_cobrar AS
SELECT c.id, c.cliente_id, cl.nombre AS cliente, cl.tipo_documento || '-' || cl.documento AS documento,
       c.venta_id, v.numero AS venta_numero, v.numero_factura_fiscal AS factura,
       c.monto_original_usd, c.monto_original_ves, c.saldo_usd, c.saldo_ves, c.fecha_vencimiento, c.estado,
       c.created_at, (v.fecha_valor) AS fecha_venta,
       (c.estado = 'PENDIENTE' AND c.fecha_vencimiento < fn_hoy()) AS vencida,
       c.fecha_vencimiento - fn_hoy() AS dias_para_vencer
  FROM cuentas_por_cobrar c JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN ventas v ON v.id = c.venta_id;
COMMENT ON VIEW v_cuentas_por_cobrar IS 'Cuentas por cobrar con cliente y venta. dias_para_vencer negativo = vencida.';

-- ---------------------------------------------------------------------------
--  3. Contabilidad: cuenta y parámetro, tipos de asiento, asiento de la venta a crédito
-- ---------------------------------------------------------------------------
ALTER TABLE asientos DROP CONSTRAINT IF EXISTS asientos_origen_tipo_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN
    ('MANUAL','APERTURA','VENTA','ANULACION_VENTA','COMPRA','ANULACION_COMPRA','NOTA_CREDITO','NOTA_DEBITO','DEVOLUCION_COSTO','PAGO_PROVEEDOR','ANULACION_PAGO','CIERRE','AJUSTE_CAMBIARIO','COBRO_CLIENTE','ANULACION_COBRO'));

INSERT INTO plan_cuentas (codigo, nombre, tipo, cuenta_padre_id, permite_movimiento)
SELECT '1.1.06', 'Cuentas por cobrar a clientes', 'ACTIVO', (SELECT id FROM plan_cuentas WHERE codigo = '1.1'), true
 WHERE NOT EXISTS (SELECT 1 FROM plan_cuentas WHERE codigo = '1.1.06');
INSERT INTO contab_parametros (clave, cuenta_id, nota)
SELECT 'CUENTAS_POR_COBRAR', (SELECT id FROM plan_cuentas WHERE codigo = '1.1.06'), 'Saldo que los clientes deben por ventas a crédito'
ON CONFLICT (clave) DO NOTHING;

-- Igual que el del 10, más: la parte no pagada de una venta a crédito va al debe de Cuentas por cobrar (en Bs del documento).
CREATE OR REPLACE FUNCTION fn_asiento_venta(p_venta_id bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v ventas; lineas jsonb := '[]'::jsonb; p record; cobrado numeric := 0; ventas_bs numeric; igtf numeric; costo numeric; dif numeric; cxc numeric := 0;
BEGIN
    SELECT * INTO v FROM ventas WHERE id = p_venta_id;
    FOR p IN SELECT COALESCE(mc.cuenta_id, CASE WHEN m.requiere_referencia THEN fn_cuenta_param('BANCOS') ELSE fn_cuenta_param('CAJA') END) AS cuenta_id,
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

-- ---------------------------------------------------------------------------
--  4. Validación de pagos (el cuadre estricto se conserva cuando NO es crédito)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validar_pagos_venta(p_venta_id bigint) RETURNS void
LANGUAGE plpgsql STABLE AS $$
DECLARE v ventas; pagado numeric; tol numeric; lineas int;
BEGIN
    SELECT * INTO v FROM ventas WHERE id = p_venta_id;
    IF v.id IS NULL OR v.estado <> 'COMPLETADA' THEN RETURN; END IF;
    SELECT count(*) INTO lineas FROM detalle_venta WHERE venta_id = p_venta_id;
    IF lineas = 0 THEN RAISE EXCEPTION 'La venta % no tiene productos', v.numero USING ERRCODE = 'TV006'; END IF;
    SELECT COALESCE(sum(monto_usd), 0) INTO pagado FROM pagos_venta WHERE venta_id = p_venta_id;
    SELECT COALESCE(tolerancia_pago_usd, 0.01) INTO tol FROM negocio WHERE id = fn_negocio_actual();
    tol := COALESCE(tol, 0.01);
    IF v.es_credito THEN
        -- Crédito: se puede pagar menos (o nada), nunca más; exige cliente y que lo que falta esté en cuentas por cobrar.
        IF v.cliente_id IS NULL THEN RAISE EXCEPTION 'Una venta a crédito necesita un cliente' USING ERRCODE = 'TV006'; END IF;
        IF pagado > v.total_usd + tol THEN
            RAISE EXCEPTION 'Los pagos (USD %) superan el total de la venta (USD %)', pagado, v.total_usd USING ERRCODE = 'TV004';
        END IF;
        IF v.total_usd - pagado > tol AND NOT EXISTS (SELECT 1 FROM cuentas_por_cobrar WHERE venta_id = v.id) THEN
            RAISE EXCEPTION 'La venta a crédito % no tiene su cuenta por cobrar', v.numero USING ERRCODE = 'TV004';
        END IF;
    ELSIF abs(pagado - v.total_usd) > tol THEN
        RAISE EXCEPTION 'Los pagos (USD %) no cuadran con el total de la venta (USD %)', pagado, v.total_usd USING ERRCODE = 'TV004';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
--  5. fn_registrar_venta con crédito
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS fn_registrar_venta(bigint, jsonb, jsonb, bigint, text, text);
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

-- ---------------------------------------------------------------------------
--  6. Movimientos de caja
-- ---------------------------------------------------------------------------
-- Registra un movimiento en el turno abierto del usuario. Devuelve NULL (sin error) si p_obligatorio = false y no hay turno.
CREATE OR REPLACE FUNCTION fn_registrar_movimiento_caja(
    p_usuario_id bigint, p_tipo text, p_concepto text, p_moneda char(3), p_monto numeric, p_referencia text DEFAULT NULL,
    p_origen text DEFAULT 'MANUAL', p_pago_cobrar_id bigint DEFAULT NULL, p_es_efectivo boolean DEFAULT true, p_obligatorio boolean DEFAULT true)
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
    INSERT INTO movimientos_caja (apertura_id, tipo, concepto, monto, moneda, tasa_usd, tasa_ves, monto_usd, monto_ves, referencia, es_efectivo, origen, pago_cobrar_id, usuario_id)
    VALUES (ap, p_tipo, trim(p_concepto), ROUND(p_monto, 2), p_moneda, t_usd, t_ves, ROUND(p_monto * t_usd, 2), ROUND(p_monto * t_ves, 2),
            NULLIF(trim(p_referencia), ''), COALESCE(p_es_efectivo, true), p_origen, p_pago_cobrar_id, p_usuario_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- Anula un movimiento MANUAL del turno abierto (los de cobranza se anulan anulando el cobro).
CREATE OR REPLACE FUNCTION fn_anular_movimiento_caja(p_id bigint, p_motivo text, p_usuario_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m movimientos_caja; a aperturas_caja;
BEGIN
    SELECT * INTO m FROM movimientos_caja WHERE id = p_id FOR UPDATE;
    IF m.id IS NULL THEN RAISE EXCEPTION 'El movimiento no existe' USING ERRCODE = 'TV006'; END IF;
    IF m.estado = 'ANULADO' THEN RAISE EXCEPTION 'Ese movimiento ya está anulado' USING ERRCODE = 'TV006'; END IF;
    IF m.origen <> 'MANUAL' THEN RAISE EXCEPTION 'Este movimiento viene de un cobro: anula el cobro en Cuentas por cobrar' USING ERRCODE = 'TV005'; END IF;
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Escribe el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO a FROM aperturas_caja WHERE id = m.apertura_id;
    IF a.estado <> 'ABIERTA' THEN RAISE EXCEPTION 'El turno de ese movimiento ya está cerrado: no se puede anular' USING ERRCODE = 'TV005'; END IF;
    UPDATE movimientos_caja SET estado = 'ANULADO', anulado_en = now(), anulado_por = p_usuario_id, motivo_anulacion = trim(p_motivo) WHERE id = p_id;
END $$;

-- ---------------------------------------------------------------------------
--  7. Cobranza
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_registrar_pago_cobrar(
    p_cuenta_id bigint, p_fecha date, p_moneda char(3), p_monto numeric, p_referencia text, p_usuario_id bigint)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    c cuentas_por_cobrar; v_id bigint; t_usd numeric; t_ves numeric; m_usd numeric; m_ves numeric; aplicado numeric; efectivo boolean;
    nuevo_usd numeric; nuevo_ves numeric; num bigint; nombre text; dif numeric; lineas jsonb; venta_ves numeric;
BEGIN
    IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El monto del cobro debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha IS NULL OR p_fecha > fn_hoy() THEN RAISE EXCEPTION 'La fecha del cobro no puede ser futura' USING ERRCODE = 'TV006'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('tienda.cxc.' || p_cuenta_id));
    SELECT * INTO c FROM cuentas_por_cobrar WHERE id = p_cuenta_id FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'La cuenta por cobrar no existe' USING ERRCODE = 'TV006'; END IF;
    IF c.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'Esta cuenta ya está %', lower(c.estado) USING ERRCODE = 'TV006'; END IF;
    IF p_fecha < (c.created_at AT TIME ZONE 'America/Caracas')::date THEN RAISE EXCEPTION 'La fecha del cobro no puede ser anterior a la venta' USING ERRCODE = 'TV006'; END IF;
    IF fn_periodo_cerrado(p_fecha) THEN RAISE EXCEPTION 'La fecha del cobro cae en un período contable cerrado (%)', to_char(p_fecha, 'MM/YYYY') USING ERRCODE = 'TV005'; END IF;

    t_usd := CASE WHEN p_moneda = 'USD' THEN 1 ELSE fn_tasa_par(p_moneda, 'USD', p_fecha) END;
    t_ves := CASE WHEN p_moneda = 'VES' THEN 1 ELSE fn_tasa_par(p_moneda, 'VES', p_fecha) END;
    m_usd := ROUND(p_monto * t_usd, 2);  m_ves := ROUND(p_monto * t_ves, 2);
    IF m_usd <= 0 OR m_ves <= 0 THEN RAISE EXCEPTION 'El monto es demasiado pequeño' USING ERRCODE = 'TV006'; END IF;
    IF m_usd > c.saldo_usd + 0.01 THEN
        RAISE EXCEPTION 'El cobro (US$ %) es mayor que el saldo pendiente (US$ %)', to_char(m_usd, 'FM999G999G990D00'), to_char(c.saldo_usd, 'FM999G999G990D00') USING ERRCODE = 'TV006';
    END IF;
    IF m_usd > c.saldo_usd THEN m_usd := c.saldo_usd; END IF;

    nuevo_usd := c.saldo_usd - m_usd;
    -- El saldo en Bs baja a la tasa de la venta; el último cobro lo deja en cero exacto.
    aplicado := CASE WHEN nuevo_usd = 0 THEN c.saldo_ves ELSE LEAST(ROUND(m_usd * c.monto_original_ves / c.monto_original_usd, 2), c.saldo_ves) END;
    nuevo_ves := c.saldo_ves - aplicado;
    efectivo := (NULLIF(trim(COALESCE(p_referencia, '')), '') IS NULL);

    INSERT INTO pagos_cobrar (cuenta_por_cobrar_id, fecha, moneda, monto, tasa_usd, tasa_ves, monto_usd, monto_ves, aplicado_ves, es_efectivo, referencia, usuario_id)
    VALUES (c.id, p_fecha, p_moneda, ROUND(p_monto, 2), t_usd, t_ves, m_usd, m_ves, aplicado, efectivo, NULLIF(trim(p_referencia), ''), p_usuario_id)
    RETURNING id INTO v_id;

    UPDATE cuentas_por_cobrar SET saldo_usd = nuevo_usd, saldo_ves = nuevo_ves, estado = CASE WHEN nuevo_usd = 0 THEN 'PAGADA' ELSE 'PENDIENTE' END WHERE id = c.id;

    SELECT v.numero, cl.nombre INTO num, nombre FROM clientes cl LEFT JOIN ventas v ON v.id = c.venta_id WHERE cl.id = c.cliente_id;
    PERFORM fn_registrar_movimiento_caja(p_usuario_id, 'INGRESO', 'Cobro cuenta por cobrar' || COALESCE(' · venta ' || num, '') || ' · ' || nombre,
            p_moneda, p_monto, p_referencia, 'COBRO_CXC', v_id, efectivo, false);

    -- Asiento: Debe Caja/Bancos (Bs del cobro) / Haber Cuentas por cobrar (Bs de la venta); la diferencia es diferencial cambiario.
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false)
       AND (c.venta_id IS NULL OR EXISTS (SELECT 1 FROM asientos WHERE origen_tipo = 'VENTA' AND origen_id = c.venta_id)) AND aplicado > 0 THEN
        lineas := jsonb_build_array(
            jsonb_build_object('cuenta_id', fn_cuenta_param(CASE WHEN efectivo THEN 'CAJA' ELSE 'BANCOS' END), 'debe', m_ves, 'glosa', COALESCE('Ref. ' || NULLIF(trim(p_referencia), ''), 'Cobro a cliente')),
            jsonb_build_object('cuenta_id', fn_cuenta_param('CUENTAS_POR_COBRAR'), 'haber', aplicado, 'glosa', nombre));
        dif := aplicado - m_ves;      -- >0: se cobró menos Bs de los que se debían (pérdida); <0: ganancia
        IF dif > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('DIFERENCIAL_CAMBIARIO'), 'debe', dif, 'glosa', 'Diferencial cambiario (pérdida)');
        ELSIF dif < 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('DIFERENCIAL_CAMBIARIO'), 'haber', -dif, 'glosa', 'Diferencial cambiario (ganancia)'); END IF;
        PERFORM fn_crear_asiento(p_fecha, 'Cobro a cliente N.º ' || v_id, 'COBRO_CLIENTE', v_id, lineas, p_usuario_id);
    END IF;
    RETURN v_id;
END $$;

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

    UPDATE pagos_cobrar SET estado = 'ANULADO', anulado_en = now(), anulado_por = p_usuario_id, motivo_anulacion = trim(p_motivo) WHERE id = p.id;
    UPDATE cuentas_por_cobrar SET saldo_usd = saldo_usd + p.monto_usd, saldo_ves = saldo_ves + p.aplicado_ves, estado = 'PENDIENTE' WHERE id = c.id;
    -- El dinero devuelto sale de la caja abierta de quien anula (si no hay turno abierto no hay movimiento que registrar).
    PERFORM fn_registrar_movimiento_caja(p_usuario_id, 'EGRESO', 'Anulación de cobro N.º ' || p.id || ' · ' || trim(p_motivo), p.moneda, p.monto, p.referencia,
            'ANULACION_COBRO', p.id, p.es_efectivo, false);
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN
        PERFORM fn_contra_asiento('COBRO_CLIENTE', p.id, 'ANULACION_COBRO', fn_hoy(), 'Anulación del cobro N.º ' || p.id, p_usuario_id);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
--  8. Resumen del turno (Corte X mientras está abierto, Corte Z al cerrar)
-- ---------------------------------------------------------------------------
--  Efectivo esperado por moneda = fondo inicial (USD y Bs) + efectivo recibido en ventas − vueltos entregados
--                                 + ingresos de caja en efectivo (cobros de cuentas por cobrar…) − egresos de caja en efectivo.
--  «Efectivo» = método de pago sin referencia (igual que el cierre diario). Ventas del turno = las del cajero entre apertura y cierre.
CREATE OR REPLACE FUNCTION fn_resumen_apertura(p_apertura_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE a aperturas_caja; hasta timestamptz; vids bigint[]; r jsonb; metodos jsonb; ingresos jsonb; egresos jsonb; monedas jsonb; res record;
BEGIN
    SELECT * INTO a FROM aperturas_caja WHERE id = p_apertura_id;
    IF a.id IS NULL THEN RAISE EXCEPTION 'El turno de caja no existe' USING ERRCODE = 'TV006'; END IF;
    hasta := COALESCE(a.fecha_cierre, clock_timestamp());

    SELECT COALESCE(array_agg(v.id), '{}') INTO vids FROM ventas v
     WHERE v.usuario_id = a.usuario_id AND v.estado = 'COMPLETADA' AND v.fecha_hora >= a.fecha_apertura AND v.fecha_hora <= hasta;

    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY array_position(ARRAY['USD','EUR','COP','VES'], x.moneda), x.metodo), '[]'::jsonb) INTO metodos FROM (
        SELECT mp.nombre AS metodo, trim(pv.moneda) AS moneda, NOT mp.requiere_referencia AS efectivo, count(*) AS n,
               sum(pv.monto_cobrado) AS cobrado, sum(pv.monto_usd + COALESCE(pv.igtf_usd, 0)) AS usd, sum(pv.monto_ves + COALESCE(pv.igtf_ves, 0)) AS ves,
               sum(COALESCE(pv.monto_entregado, pv.monto_cobrado)) AS recibido, COALESCE(sum(pv.igtf_usd), 0) AS igtf_usd, COALESCE(sum(pv.igtf_ves), 0) AS igtf_ves
          FROM pagos_venta pv JOIN ventas t ON t.id = pv.venta_id AND t.id = ANY(vids) JOIN metodos_pago mp ON mp.id = pv.metodo_pago_id
         GROUP BY mp.id, mp.nombre, pv.moneda, mp.requiere_referencia) x;

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
                          WHERE NOT mp.requiere_referencia AND trim(pv.moneda) = mo.moneda), 0) AS recibido,
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
COMMENT ON FUNCTION fn_resumen_apertura(bigint) IS 'Cifras del turno de caja: ventas por método, IGTF, ingresos/egresos y efectivo esperado por moneda (fondo + efectivo recibido − vueltos + ingresos − egresos).';
