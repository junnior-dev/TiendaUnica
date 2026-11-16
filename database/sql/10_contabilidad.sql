-- =============================================================================
--  10 · Contabilidad general (OPCIONAL, no modifica nada existente)
-- =============================================================================
--  Agrega: plan de cuentas, libro diario (asientos), asientos automáticos de ventas y compras, y los reportes
--  Libro de inventario, Libro diario y Libro mayor. Todo en bolívares (la contabilidad en Venezuela se lleva en Bs).
--
--  CÓMO SE CONECTA CON TU BASE ACTUAL
--    · ventas / pagos_venta / detalle_venta → asiento de cada venta (Caja o Bancos / Ventas / IVA / IGTF / Costo de ventas).
--    · compras (+ v_libro_compras)            → asiento de cada compra (Inventario / IVA crédito / Cuentas por pagar).
--    · movimientos_inventario + historial_costos → Libro de inventario a cualquier fecha (stock y costo de ESA fecha).
--  Los asientos automáticos vienen APAGADOS: no pasa nada en tus ventas y compras hasta que ejecutes
--      UPDATE tienda.contab_config SET automatica = true;
--  Se disparan solo para documentos registrados DESPUÉS de activarlos. Para lo anterior, carga un asiento de apertura.
--
--  Probado contra tu esquema con COMMIT real (venta mixta con IGTF, anulación, compra con y sin crédito fiscal). Las verificaciones diferidas
--  corren al confirmar la transacción: no uses SET CONSTRAINTS ALL IMMEDIATE al registrar ventas o compras.
--  Fuera de alcance por ahora: ajustes de stock, notas de crédito/débito, pagos a proveedores, retenciones de IVA y cierre de ejercicio.
--
--  Las cuentas, los montos de ejemplo y el tratamiento contable (sobre todo del IGTF y de las anulaciones) son una
--  propuesta de partida: revísalos con tu contador antes de usarlo como contabilidad oficial.
--     psql -d tienda -f 10_contabilidad.sql
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  1. PLAN DE CUENTAS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_cuentas (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo              varchar(20)  NOT NULL CHECK (codigo ~ '^[0-9]+(\.[0-9]+)*$'),
    nombre              varchar(120) NOT NULL CHECK (length(trim(nombre)) > 0),
    tipo                varchar(10)  NOT NULL CHECK (tipo IN ('ACTIVO','PASIVO','PATRIMONIO','INGRESO','GASTO')),
    cuenta_padre_id     bigint       REFERENCES plan_cuentas(id),
    permite_movimiento  boolean      NOT NULL DEFAULT true,     -- false = cuenta de agrupación (solo suma a sus hijas)
    activa              boolean      NOT NULL DEFAULT true,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ck_cuenta_no_su_padre CHECK (cuenta_padre_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_cuentas_codigo ON plan_cuentas (codigo);
COMMENT ON TABLE  plan_cuentas IS 'Plan de cuentas jerárquico. Solo las cuentas con permite_movimiento reciben asientos.';
COMMENT ON COLUMN plan_cuentas.tipo IS 'ACTIVO y GASTO tienen saldo deudor; PASIVO, PATRIMONIO e INGRESO, acreedor.';

-- Naturaleza del saldo según el tipo (la usa el Libro mayor).
CREATE OR REPLACE FUNCTION fn_naturaleza_cuenta(p_tipo text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN p_tipo IN ('ACTIVO','GASTO') THEN 'DEUDORA' ELSE 'ACREEDORA' END $$;

-- ---------------------------------------------------------------------------
--  2. CONFIGURACIÓN: interruptor y cuentas que usan los asientos automáticos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contab_config (
    id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    automatica  boolean  NOT NULL DEFAULT false
);
INSERT INTO contab_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS contab_parametros (
    clave      varchar(30) PRIMARY KEY,
    cuenta_id  bigint      NOT NULL REFERENCES plan_cuentas(id),
    nota       text
);
COMMENT ON TABLE contab_parametros IS 'Qué cuenta usa cada asiento automático. Cámbialas si tu plan de cuentas es otro.';

-- Cuenta propia para un método de pago (opcional). Sin fila: efectivo (no pide referencia) → CAJA; el resto → BANCOS.
CREATE TABLE IF NOT EXISTS contab_metodo_cuenta (
    metodo_pago_id bigint PRIMARY KEY REFERENCES metodos_pago(id),
    cuenta_id      bigint NOT NULL REFERENCES plan_cuentas(id)
);

-- ---------------------------------------------------------------------------
--  3. LIBRO DIARIO: asientos (inmutables, siempre cuadrados)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asientos (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero_asiento      bigint       NOT NULL UNIQUE,
    fecha               date         NOT NULL,
    concepto            text         NOT NULL CHECK (length(trim(concepto)) > 0),
    total_debe          numeric(18,2) NOT NULL CHECK (total_debe > 0),
    total_haber         numeric(18,2) NOT NULL,
    origen_tipo         varchar(20)  NOT NULL DEFAULT 'MANUAL' CHECK (origen_tipo IN ('MANUAL','APERTURA','VENTA','ANULACION_VENTA','COMPRA','ANULACION_COMPRA','NOTA_CREDITO','NOTA_DEBITO','DEVOLUCION_COSTO')),
    origen_id           bigint,
    usuario_id          bigint       REFERENCES usuarios(id),
    created_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ck_asiento_cuadrado CHECK (total_debe = total_haber)
);
-- Un documento genera un solo asiento de cada tipo (evita duplicados si el trigger se repitiera).
CREATE UNIQUE INDEX IF NOT EXISTS uq_asiento_origen ON asientos (origen_tipo, origen_id) WHERE origen_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_asientos_fecha ON asientos (fecha, numero_asiento);

CREATE TABLE IF NOT EXISTS asiento_detalle (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asiento_id  bigint        NOT NULL REFERENCES asientos(id),
    cuenta_id   bigint        NOT NULL REFERENCES plan_cuentas(id),
    debe        numeric(18,2) NOT NULL DEFAULT 0 CHECK (debe >= 0),
    haber       numeric(18,2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
    glosa       text,
    CONSTRAINT ck_linea_un_lado CHECK ((debe > 0) <> (haber > 0))      -- cada línea va al debe O al haber, nunca ambos ni cero
);
CREATE INDEX IF NOT EXISTS ix_asiento_det_asiento ON asiento_detalle (asiento_id);
CREATE INDEX IF NOT EXISTS ix_asiento_det_cuenta  ON asiento_detalle (cuenta_id);

-- Solo se insertan: para corregir se hace un contra-asiento (como con el kardex). Reutiliza el trigger de tu esquema.
DROP TRIGGER IF EXISTS trg_asientos_inmutable ON asientos;
CREATE TRIGGER trg_asientos_inmutable BEFORE UPDATE OR DELETE ON asientos FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();
DROP TRIGGER IF EXISTS trg_asiento_det_inmutable ON asiento_detalle;
CREATE TRIGGER trg_asiento_det_inmutable BEFORE UPDATE OR DELETE ON asiento_detalle FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();

-- Solo cuentas activas y de movimiento reciben líneas.
CREATE OR REPLACE FUNCTION trg_asiento_det_cuenta() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c plan_cuentas;
BEGIN
    SELECT * INTO c FROM plan_cuentas WHERE id = NEW.cuenta_id;
    IF NOT c.permite_movimiento OR NOT c.activa THEN
        RAISE EXCEPTION 'La cuenta % (%) no admite movimientos', c.codigo, c.nombre USING ERRCODE = 'TV006';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_asiento_det_cuenta ON asiento_detalle;
CREATE TRIGGER trg_asiento_det_cuenta BEFORE INSERT ON asiento_detalle FOR EACH ROW EXECUTE FUNCTION trg_asiento_det_cuenta();

-- Red de seguridad al confirmar la transacción: las líneas deben sumar exactamente los totales de la cabecera.
CREATE OR REPLACE FUNCTION trg_asiento_verificar() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; h numeric;
BEGIN
    SELECT COALESCE(sum(debe), 0), COALESCE(sum(haber), 0) INTO d, h FROM asiento_detalle WHERE asiento_id = NEW.id;
    IF d <> NEW.total_debe OR h <> NEW.total_haber OR d <> h THEN
        RAISE EXCEPTION 'El asiento % no cuadra: debe % / haber % (cabecera %)', NEW.numero_asiento, d, h, NEW.total_debe USING ERRCODE = 'TV005';
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_asiento_verificar ON asientos;
CREATE CONSTRAINT TRIGGER trg_asiento_verificar AFTER INSERT ON asientos
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_asiento_verificar();

-- Número correlativo del asiento (el candado dura hasta el COMMIT: dos cajas no obtienen el mismo número).
CREATE OR REPLACE FUNCTION fn_siguiente_numero_asiento() RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('tienda.asientos.numero'));
    RETURN COALESCE((SELECT max(numero_asiento) FROM asientos), 0) + 1;
END $$;

-- Crea un asiento completo. p_lineas: [{"cuenta_id":1,"debe":100.00,"glosa":"..."},{"cuenta_id":2,"haber":100.00}]
-- Es la ÚNICA puerta de entrada: la usan los triggers de abajo y sirve también para asientos manuales (origen MANUAL).
CREATE OR REPLACE FUNCTION fn_crear_asiento(p_fecha date, p_concepto text, p_origen_tipo text, p_origen_id bigint, p_lineas jsonb, p_usuario_id bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; d numeric; h numeric; l record;
BEGIN
    SELECT COALESCE(sum(debe), 0), COALESCE(sum(haber), 0) INTO d, h
      FROM jsonb_to_recordset(p_lineas) AS x(cuenta_id bigint, debe numeric, haber numeric, glosa text);
    IF d <> h THEN RAISE EXCEPTION 'El asiento no cuadra: debe % y haber %', d, h USING ERRCODE = 'TV006'; END IF;
    IF d = 0 THEN RAISE EXCEPTION 'El asiento no tiene montos' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO asientos (numero_asiento, fecha, concepto, total_debe, total_haber, origen_tipo, origen_id, usuario_id)
    VALUES (fn_siguiente_numero_asiento(), p_fecha, trim(p_concepto), d, h, p_origen_tipo, p_origen_id, p_usuario_id) RETURNING id INTO v_id;
    FOR l IN SELECT * FROM jsonb_to_recordset(p_lineas) AS x(cuenta_id bigint, debe numeric, haber numeric, glosa text) LOOP
        CONTINUE WHEN COALESCE(l.debe, 0) = 0 AND COALESCE(l.haber, 0) = 0;
        INSERT INTO asiento_detalle (asiento_id, cuenta_id, debe, haber, glosa) VALUES (v_id, l.cuenta_id, COALESCE(l.debe, 0), COALESCE(l.haber, 0), l.glosa);
    END LOOP;
    RETURN v_id;
END $$;

-- Cuenta configurada para una clave (error claro si falta).
CREATE OR REPLACE FUNCTION fn_cuenta_param(p_clave text) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE c bigint;
BEGIN
    SELECT cuenta_id INTO c FROM contab_parametros WHERE clave = p_clave;
    IF c IS NULL THEN RAISE EXCEPTION 'Falta configurar la cuenta contable "%" (tabla contab_parametros)', p_clave USING ERRCODE = 'TV006'; END IF;
    RETURN c;
END $$;

-- ---------------------------------------------------------------------------
--  4. ASIENTO AUTOMÁTICO DE UNA VENTA
-- ---------------------------------------------------------------------------
--    Debe   Caja / Bancos (por método de pago)       = lo cobrado (monto + IGTF) en Bs
--    Haber  Ventas de mercancía                       = base + exento (sin IVA)
--    Haber  IVA débito fiscal por pagar               = ventas.iva_ves
--    Haber  IGTF por pagar                            = suma de pagos_venta.igtf_ves
--    Debe   Costo de ventas / Haber Inventario        = cantidad × costo congelado en la línea (detalle_venta.costo_unitario_usd) × tasa de la venta
--    ± Diferencia por redondeo: absorbe los centavos que deja convertir USD ↔ Bs en los pagos (ya acotados por tu tolerancia de pago).
CREATE OR REPLACE FUNCTION fn_asiento_venta(p_venta_id bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v ventas; lineas jsonb := '[]'::jsonb; p record; cobrado numeric := 0; ventas_bs numeric; igtf numeric; costo numeric; dif numeric;
BEGIN
    SELECT * INTO v FROM ventas WHERE id = p_venta_id;
    -- Cobros: una línea al debe por cuenta (CAJA o BANCOS o la propia del método de pago).
    FOR p IN SELECT COALESCE(mc.cuenta_id, CASE WHEN m.requiere_referencia THEN fn_cuenta_param('BANCOS') ELSE fn_cuenta_param('CAJA') END) AS cuenta_id,
                    sum(pv.monto_ves + COALESCE(pv.igtf_ves, 0)) AS monto
               FROM pagos_venta pv JOIN metodos_pago m ON m.id = pv.metodo_pago_id LEFT JOIN contab_metodo_cuenta mc ON mc.metodo_pago_id = m.id
              WHERE pv.venta_id = p_venta_id GROUP BY 1 ORDER BY 1 LOOP
        lineas := lineas || jsonb_build_object('cuenta_id', p.cuenta_id, 'debe', p.monto, 'glosa', 'Cobro de la venta ' || v.numero);
        cobrado := cobrado + p.monto;
    END LOOP;
    ventas_bs := v.base_ves + v.exento_ves;
    igtf := COALESCE((SELECT sum(igtf_ves) FROM pagos_venta WHERE venta_id = p_venta_id), 0);
    lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('VENTAS'), 'haber', ventas_bs, 'glosa', 'Venta sin IVA');
    IF v.iva_ves > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('IVA_DEBITO'), 'haber', v.iva_ves, 'glosa', 'IVA de la venta'); END IF;
    IF igtf > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('IGTF_POR_PAGAR'), 'haber', igtf, 'glosa', 'IGTF percibido en divisas'); END IF;
    dif := cobrado - (ventas_bs + v.iva_ves + igtf);
    IF dif > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('REDONDEO'), 'haber', dif, 'glosa', 'Diferencia por redondeo');
    ELSIF dif < 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('REDONDEO'), 'debe', -dif, 'glosa', 'Diferencia por redondeo'); END IF;
    costo := ROUND(COALESCE((SELECT sum(ROUND(cantidad * costo_unitario_usd, 2)) FROM detalle_venta WHERE venta_id = p_venta_id), 0) * v.tasa_cambio, 2);
    IF costo > 0 THEN
        lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('COSTO_VENTAS'), 'debe', costo, 'glosa', 'Costo de la mercancía vendida')
                         || jsonb_build_object('cuenta_id', fn_cuenta_param('INVENTARIO'), 'haber', costo, 'glosa', 'Salida de inventario');
    END IF;
    RETURN fn_crear_asiento(v.fecha_valor, 'Venta ' || v.numero, 'VENTA', p_venta_id, lineas, v.usuario_id);
END $$;

-- Contra-asiento: copia las líneas de un asiento con el debe y el haber invertidos.
-- IGTF: según el criterio de tu esquema (v_igtf_a_declarar) el IGTF cobrado se sigue declarando aunque se anule la venta; lo devuelto al cliente
-- queda como «reintegro por reclamar al SENIAT» (activo), no como una baja del pasivo. Confírmalo con tu contador.
CREATE OR REPLACE FUNCTION fn_contra_asiento(p_origen_tipo text, p_origen_id bigint, p_nuevo_tipo text, p_fecha date, p_concepto text, p_usuario_id bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE a asientos; lineas jsonb; igtf_pagar bigint;
BEGIN
    SELECT * INTO a FROM asientos WHERE origen_tipo = p_origen_tipo AND origen_id = p_origen_id;
    IF a.id IS NULL THEN RETURN NULL; END IF;     -- el documento es anterior a la contabilidad automática: no hay nada que revertir
    SELECT cuenta_id INTO igtf_pagar FROM contab_parametros WHERE clave = 'IGTF_POR_PAGAR';
    SELECT jsonb_agg(jsonb_build_object(
               'cuenta_id', CASE WHEN p_origen_tipo = 'VENTA' AND d.cuenta_id = igtf_pagar THEN fn_cuenta_param('IGTF_POR_RECLAMAR') ELSE d.cuenta_id END,
               'debe', d.haber, 'haber', d.debe, 'glosa', 'Reverso: ' || COALESCE(d.glosa, '')) ORDER BY d.id)
      INTO lineas FROM asiento_detalle d WHERE d.asiento_id = a.id;
    RETURN fn_crear_asiento(p_fecha, p_concepto, p_nuevo_tipo, p_origen_id, lineas, p_usuario_id);
END $$;

-- Disparadores de ventas. El de alta es DIFERIDO (igual que tu trg_pagos_mixto): corre al confirmar, cuando ya existen líneas y pagos.
CREATE OR REPLACE FUNCTION trg_contab_venta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN RETURN NULL; END IF;
    PERFORM fn_asiento_venta(NEW.id);
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contab_venta ON ventas;
CREATE CONSTRAINT TRIGGER trg_contab_venta AFTER INSERT ON ventas
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_contab_venta();

CREATE OR REPLACE FUNCTION trg_contab_venta_anulada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN
        PERFORM fn_contra_asiento('VENTA', NEW.id, 'ANULACION_VENTA', fn_hoy(), 'Anulación de la venta ' || NEW.numero, NEW.anulada_por);
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contab_venta_anulada ON ventas;
CREATE TRIGGER trg_contab_venta_anulada AFTER UPDATE OF estado ON ventas
    FOR EACH ROW WHEN (OLD.estado = 'COMPLETADA' AND NEW.estado = 'ANULADA') EXECUTE FUNCTION trg_contab_venta_anulada();

-- ---------------------------------------------------------------------------
--  5. ASIENTO AUTOMÁTICO DE UNA COMPRA (para que el Inventario también tenga su entrada)
-- ---------------------------------------------------------------------------
--    Debe   Inventario de mercancía     = base + exento (+ IVA si NO es crédito fiscal: «IVA al costo»)
--    Debe   IVA crédito fiscal          = IVA, solo si aplica crédito fiscal
--    Haber  Cuentas por pagar           = total de la factura en Bs (a la tasa de la fecha, igual que v_libro_compras)
CREATE OR REPLACE FUNCTION fn_asiento_compra(p_compra_id bigint) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE l v_libro_compras; c compras; inv numeric; lineas jsonb := '[]'::jsonb;
BEGIN
    SELECT * INTO c FROM compras WHERE id = p_compra_id;
    SELECT * INTO l FROM v_libro_compras WHERE compra_id = p_compra_id;
    IF l.total_ves IS NULL THEN
        RAISE EXCEPTION 'Para contabilizar la compra falta la tasa USD → Bs de esa fecha. Cárguela en Tasas de cambio.' USING ERRCODE = 'TV002';
    END IF;
    inv := l.base_imponible_ves + l.exento_ves + CASE WHEN c.aplica_credito_fiscal THEN 0 ELSE l.iva_ves END;
    lineas := jsonb_build_array(jsonb_build_object('cuenta_id', fn_cuenta_param('INVENTARIO'), 'debe', inv, 'glosa', 'Mercancía comprada'));
    IF c.aplica_credito_fiscal AND l.iva_ves > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('IVA_CREDITO'), 'debe', l.iva_ves, 'glosa', 'IVA crédito fiscal'); END IF;
    lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('CUENTAS_POR_PAGAR'), 'haber', l.total_ves, 'glosa', l.proveedor);
    RETURN fn_crear_asiento(c.fecha_factura, 'Compra ' || c.numero_factura || ' · ' || l.proveedor, 'COMPRA', p_compra_id, lineas, c.usuario_id);
END $$;

CREATE OR REPLACE FUNCTION trg_contab_compra() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN PERFORM fn_asiento_compra(NEW.id); END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contab_compra ON compras;
CREATE CONSTRAINT TRIGGER trg_contab_compra AFTER INSERT ON compras
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_contab_compra();

CREATE OR REPLACE FUNCTION trg_contab_compra_anulada() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN
        PERFORM fn_contra_asiento('COMPRA', NEW.id, 'ANULACION_COMPRA', fn_hoy(), 'Anulación de la compra ' || NEW.numero_factura, NEW.anulada_por);
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contab_compra_anulada ON compras;
CREATE TRIGGER trg_contab_compra_anulada AFTER UPDATE OF estado ON compras
    FOR EACH ROW WHEN (OLD.estado = 'REGISTRADA' AND NEW.estado = 'ANULADA') EXECUTE FUNCTION trg_contab_compra_anulada();

-- ---------------------------------------------------------------------------
--  5b. ASIENTOS DE NOTAS DE CRÉDITO Y DE DÉBITO (notas_ajuste)
-- ---------------------------------------------------------------------------
-- Instalaciones que ya tenían la tabla `asientos`: amplía el CHECK de origen_tipo (idempotente; incluye también los tipos del 11 para que reinstalar el 10 no choque con asientos ya creados).
ALTER TABLE asientos DROP CONSTRAINT IF EXISTS asientos_origen_tipo_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN
    ('MANUAL','APERTURA','VENTA','ANULACION_VENTA','COMPRA','ANULACION_COMPRA','NOTA_CREDITO','NOTA_DEBITO','DEVOLUCION_COSTO','PAGO_PROVEEDOR','ANULACION_PAGO','CIERRE','AJUSTE_CAMBIARIO'));

-- Cuenta de pago de una nota: la nota no guarda cómo se pagó, así que se toma la de la venta original,
-- la del método con mayor monto (la propia del método si la configuraste; si no BANCOS cuando pide referencia, o CAJA).
CREATE OR REPLACE FUNCTION fn_cuenta_pago_venta(p_venta_id bigint) RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE c bigint;
BEGIN
    SELECT COALESCE(mc.cuenta_id, CASE WHEN m.requiere_referencia THEN fn_cuenta_param('BANCOS') ELSE fn_cuenta_param('CAJA') END)
      INTO c
      FROM pagos_venta pv JOIN metodos_pago m ON m.id = pv.metodo_pago_id LEFT JOIN contab_metodo_cuenta mc ON mc.metodo_pago_id = m.id
     WHERE pv.venta_id = p_venta_id
     ORDER BY pv.monto_ves DESC, pv.id LIMIT 1;
    RETURN COALESCE(c, fn_cuenta_param('CAJA'));
END $$;

-- Nota de crédito (devolución o descuento al cliente): reversa parcial de la venta.
--    Debe   Ventas de mercancía      = base_ves
--    Debe   IVA débito fiscal        = iva_ves (baja lo que debes declarar)
--    Haber  Caja / Bancos            = total_ves (lo devuelto al cliente)
CREATE OR REPLACE FUNCTION trg_contab_nota_credito() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lineas jsonb; v_numero text;
BEGIN
    IF NEW.tipo <> 'C' OR NOT COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN RETURN NULL; END IF;
    SELECT numero INTO v_numero FROM ventas WHERE id = NEW.venta_id;
    lineas := jsonb_build_array(jsonb_build_object('cuenta_id', fn_cuenta_param('VENTAS'), 'debe', NEW.base_ves, 'glosa', 'Nota de crédito ' || NEW.numero));
    IF NEW.iva_ves > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('IVA_DEBITO'), 'debe', NEW.iva_ves, 'glosa', 'IVA de la nota de crédito'); END IF;
    lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_pago_venta(NEW.venta_id), 'haber', NEW.total_ves, 'glosa', 'Devolución al cliente (venta ' || v_numero || ')');
    PERFORM fn_crear_asiento(NEW.fecha, 'Nota de crédito ' || NEW.numero || ' sobre la venta ' || v_numero, 'NOTA_CREDITO', NEW.id, lineas, NEW.usuario_id);
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contab_nota_credito ON notas_ajuste;
CREATE TRIGGER trg_contab_nota_credito AFTER INSERT ON notas_ajuste
    FOR EACH ROW WHEN (NEW.tipo = 'C') EXECUTE FUNCTION trg_contab_nota_credito();

-- Nota de débito (cargo adicional al cliente):
--    Debe   Caja / Bancos            = total_ves
--    Haber  Ventas de mercancía      = base_ves
--    Haber  IVA débito fiscal        = iva_ves
CREATE OR REPLACE FUNCTION trg_contab_nota_debito() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lineas jsonb; v_numero text;
BEGIN
    IF NEW.tipo <> 'D' OR NOT COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN RETURN NULL; END IF;
    SELECT numero INTO v_numero FROM ventas WHERE id = NEW.venta_id;
    lineas := jsonb_build_array(jsonb_build_object('cuenta_id', fn_cuenta_pago_venta(NEW.venta_id), 'debe', NEW.total_ves, 'glosa', 'Cobro de la nota de débito ' || NEW.numero),
                                jsonb_build_object('cuenta_id', fn_cuenta_param('VENTAS'), 'haber', NEW.base_ves, 'glosa', 'Nota de débito ' || NEW.numero));
    IF NEW.iva_ves > 0 THEN lineas := lineas || jsonb_build_object('cuenta_id', fn_cuenta_param('IVA_DEBITO'), 'haber', NEW.iva_ves, 'glosa', 'IVA de la nota de débito'); END IF;
    PERFORM fn_crear_asiento(NEW.fecha, 'Nota de débito ' || NEW.numero || ' sobre la venta ' || v_numero, 'NOTA_DEBITO', NEW.id, lineas, NEW.usuario_id);
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contab_nota_debito ON notas_ajuste;
CREATE TRIGGER trg_contab_nota_debito AFTER INSERT ON notas_ajuste
    FOR EACH ROW WHEN (NEW.tipo = 'D') EXECUTE FUNCTION trg_contab_nota_debito();

-- ---------------------------------------------------------------------------
--  6. PLAN DE CUENTAS INICIAL (propuesta: ajústalo con tu contador)
-- ---------------------------------------------------------------------------
INSERT INTO plan_cuentas (codigo, nombre, tipo, permite_movimiento) VALUES
  ('1','ACTIVO','ACTIVO',false), ('2','PASIVO','PASIVO',false), ('3','PATRIMONIO','PATRIMONIO',false), ('4','INGRESOS','INGRESO',false), ('5','COSTOS Y GASTOS','GASTO',false)
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO plan_cuentas (codigo, nombre, tipo, cuenta_padre_id, permite_movimiento)
SELECT x.codigo, x.nombre, x.tipo, (SELECT id FROM plan_cuentas WHERE codigo = x.padre), x.mov
  FROM (VALUES
    ('1.1','Activo corriente','ACTIVO','1',false),
    ('1.1.01','Caja','ACTIVO','1.1',true), ('1.1.02','Bancos','ACTIVO','1.1',true),
    ('1.1.03','Inventario de mercancía','ACTIVO','1.1',true), ('1.1.04','IVA crédito fiscal','ACTIVO','1.1',true),
    ('1.1.05','IGTF por reclamar al SENIAT','ACTIVO','1.1',true),
    ('2.1','Pasivo corriente','PASIVO','2',false),
    ('2.1.01','Cuentas por pagar a proveedores','PASIVO','2.1',true), ('2.1.02','IVA débito fiscal por pagar','PASIVO','2.1',true),
    ('2.1.03','IGTF por pagar','PASIVO','2.1',true),
    ('3.1','Capital y resultados','PATRIMONIO','3',false),
    ('3.1.01','Capital social','PATRIMONIO','3.1',true), ('3.1.02','Resultados acumulados','PATRIMONIO','3.1',true),
    ('4.1','Ingresos por ventas','INGRESO','4',false), ('4.1.01','Ventas de mercancía','INGRESO','4.1',true),
    ('5.1','Costo de ventas','GASTO','5',false), ('5.1.01','Costo de la mercancía vendida','GASTO','5.1',true),
    ('5.2','Gastos operativos','GASTO','5',false), ('5.2.01','Diferencias por redondeo','GASTO','5.2',true), ('5.2.02','Gastos generales','GASTO','5.2',true)
  ) AS x(codigo, nombre, tipo, padre, mov)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO contab_parametros (clave, cuenta_id, nota)
SELECT x.clave, (SELECT id FROM plan_cuentas WHERE codigo = x.codigo), x.nota
  FROM (VALUES
    ('CAJA','1.1.01','Cobros en efectivo (métodos que no piden referencia)'), ('BANCOS','1.1.02','Pago móvil, transferencias, punto de venta, Zelle…'),
    ('INVENTARIO','1.1.03',NULL), ('IVA_CREDITO','1.1.04',NULL), ('IGTF_POR_RECLAMAR','1.1.05','IGTF devuelto al cliente por anulación'),
    ('CUENTAS_POR_PAGAR','2.1.01',NULL), ('IVA_DEBITO','2.1.02',NULL), ('IGTF_POR_PAGAR','2.1.03',NULL),
    ('VENTAS','4.1.01',NULL), ('COSTO_VENTAS','5.1.01',NULL), ('REDONDEO','5.2.01','Centavos de conversión USD ↔ Bs')
  ) AS x(clave, codigo, nota)
ON CONFLICT (clave) DO NOTHING;

-- ---------------------------------------------------------------------------
--  7. REPORTES
-- ---------------------------------------------------------------------------

-- 7.1 LIBRO DE INVENTARIO a una fecha de cierre (ej. fn_libro_inventario('2026-10-31')).
--   Existencia = stock_resultante del último movimiento del kardex hasta esa fecha.
--   Costo      = costo_nuevo_usd del último cambio en historial_costos hasta esa fecha (si el producto no tiene historial, el costo actual).
--   Una fila por categoría y, al final, el GRAN TOTAL (categoria_id NULL, es_total = true).
--   Valor en Bs = valor USD × tasa del día del cierre (queda NULL si no hay tasa cargada para esa fecha).
CREATE OR REPLACE FUNCTION fn_libro_inventario(p_hasta date)
RETURNS TABLE (categoria_id bigint, categoria text, es_total boolean, productos bigint, unidades numeric, costo_promedio_usd numeric, valor_usd numeric, valor_ves numeric)
LANGUAGE plpgsql STABLE AS $$
DECLARE corte timestamptz := ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Caracas'); t numeric;
BEGIN
    BEGIN t := (fn_tasa_aplicable(p_hasta)).tasa; EXCEPTION WHEN OTHERS THEN t := NULL; END;
    RETURN QUERY
    WITH base AS (
        SELECT p.categoria_id AS cat, COALESCE(c.nombre, 'Sin categoría')::text AS cat_nombre,
               COALESCE(s.stock, 0) AS stock, COALESCE(h.costo, p.costo_usd) AS costo
          FROM productos p
          LEFT JOIN categorias c ON c.id = p.categoria_id
          LEFT JOIN LATERAL (SELECT m.stock_resultante AS stock FROM movimientos_inventario m
                              WHERE m.producto_id = p.id AND m.fecha < corte ORDER BY m.fecha DESC, m.id DESC LIMIT 1) s ON true
          LEFT JOIN LATERAL (SELECT hc.costo_nuevo_usd AS costo FROM historial_costos hc
                              WHERE hc.producto_id = p.id AND hc.fecha < corte ORDER BY hc.fecha DESC, hc.id DESC LIMIT 1) h ON true
         WHERE COALESCE(s.stock, 0) <> 0
    )
    SELECT b.cat, (CASE WHEN GROUPING(b.cat, b.cat_nombre) = 3 THEN 'GRAN TOTAL' ELSE b.cat_nombre END)::text, GROUPING(b.cat, b.cat_nombre) = 3,
           count(*), sum(b.stock),
           CASE WHEN sum(b.stock) <> 0 THEN ROUND(sum(b.stock * b.costo) / sum(b.stock), 4) END,
           ROUND(sum(b.stock * b.costo), 2),
           CASE WHEN t IS NOT NULL THEN ROUND(sum(b.stock * b.costo) * t, 2) END
      FROM base b GROUP BY ROLLUP ((b.cat, b.cat_nombre))
     ORDER BY GROUPING(b.cat, b.cat_nombre), 2;
END $$;
COMMENT ON FUNCTION fn_libro_inventario(date) IS 'Inventario valorizado por categoría al cierre de la fecha dada, con gran total.';

-- 7.1b LIBRO DE INVENTARIO DETALLADO: una fila por producto con existencia (código, descripción, unidad, cantidad, costo unitario y valor).
--   Es el formato que se imprime y se firma: el Código de Comercio pide el inventario por bienes, no solo por categoría. Mismas reglas de existencia, costo y tasa que fn_libro_inventario.
CREATE OR REPLACE FUNCTION fn_libro_inventario_detalle(p_hasta date)
RETURNS TABLE (categoria text, sku text, producto text, unidad text, existencia numeric, costo_usd numeric, valor_usd numeric, valor_ves numeric)
LANGUAGE plpgsql STABLE AS $$
DECLARE corte timestamptz := ((p_hasta + 1)::timestamp AT TIME ZONE 'America/Caracas'); t numeric;
BEGIN
    BEGIN t := (fn_tasa_aplicable(p_hasta)).tasa; EXCEPTION WHEN OTHERS THEN t := NULL; END;
    RETURN QUERY
    SELECT COALESCE(c.nombre, 'Sin categoría')::text, p.sku::text, p.nombre::text, p.unidad::text, s.stock, COALESCE(h.costo, p.costo_usd),
           ROUND(s.stock * COALESCE(h.costo, p.costo_usd), 2),
           CASE WHEN t IS NOT NULL THEN ROUND(s.stock * COALESCE(h.costo, p.costo_usd) * t, 2) END
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      JOIN LATERAL (SELECT m.stock_resultante AS stock FROM movimientos_inventario m
                     WHERE m.producto_id = p.id AND m.fecha < corte ORDER BY m.fecha DESC, m.id DESC LIMIT 1) s ON s.stock <> 0
      LEFT JOIN LATERAL (SELECT hc.costo_nuevo_usd AS costo FROM historial_costos hc
                          WHERE hc.producto_id = p.id AND hc.fecha < corte ORDER BY hc.fecha DESC, hc.id DESC LIMIT 1) h ON true
     ORDER BY 1, p.nombre;
END $$;
COMMENT ON FUNCTION fn_libro_inventario_detalle(date) IS 'Inventario valorizado por producto al cierre de la fecha dada (para imprimir el libro de inventarios).';

-- 7.2 LIBRO DIARIO cronológico: cada asiento con sus líneas (Debe / Haber).
CREATE OR REPLACE FUNCTION fn_libro_diario(p_desde date, p_hasta date)
RETURNS TABLE (fecha date, numero_asiento bigint, concepto text, codigo varchar, cuenta text, debe numeric, haber numeric, glosa text)
LANGUAGE sql STABLE AS $$
    SELECT a.fecha, a.numero_asiento, a.concepto, c.codigo, c.nombre::text, d.debe, d.haber, d.glosa
      FROM asientos a JOIN asiento_detalle d ON d.asiento_id = a.id JOIN plan_cuentas c ON c.id = d.cuenta_id
     WHERE a.fecha BETWEEN p_desde AND p_hasta
     ORDER BY a.fecha, a.numero_asiento, d.haber > 0, d.id          -- primero las líneas del debe, luego las del haber
$$;

-- 7.3 LIBRO MAYOR por cuenta: saldo inicial (antes de p_desde), débitos y créditos del período, saldo final.
--   El saldo se expresa según la naturaleza de la cuenta: ACTIVO/GASTO = debe − haber; PASIVO/PATRIMONIO/INGRESO = haber − debe.
CREATE OR REPLACE FUNCTION fn_libro_mayor(p_desde date, p_hasta date)
RETURNS TABLE (codigo varchar, cuenta text, tipo varchar, naturaleza text, saldo_inicial numeric, debitos numeric, creditos numeric, saldo_final numeric)
LANGUAGE sql STABLE AS $$
    WITH mov AS (
        SELECT d.cuenta_id,
               COALESCE(sum(d.debe)  FILTER (WHERE a.fecha <  p_desde), 0) AS d_ini, COALESCE(sum(d.haber) FILTER (WHERE a.fecha <  p_desde), 0) AS h_ini,
               COALESCE(sum(d.debe)  FILTER (WHERE a.fecha >= p_desde), 0) AS d_per, COALESCE(sum(d.haber) FILTER (WHERE a.fecha >= p_desde), 0) AS h_per
          FROM asiento_detalle d JOIN asientos a ON a.id = d.asiento_id WHERE a.fecha <= p_hasta GROUP BY d.cuenta_id)
    SELECT c.codigo, c.nombre::text, c.tipo, fn_naturaleza_cuenta(c.tipo),
           CASE WHEN fn_naturaleza_cuenta(c.tipo) = 'DEUDORA' THEN m.d_ini - m.h_ini ELSE m.h_ini - m.d_ini END,
           m.d_per, m.h_per,
           CASE WHEN fn_naturaleza_cuenta(c.tipo) = 'DEUDORA' THEN (m.d_ini + m.d_per) - (m.h_ini + m.h_per) ELSE (m.h_ini + m.h_per) - (m.d_ini + m.d_per) END
      FROM mov m JOIN plan_cuentas c ON c.id = m.cuenta_id ORDER BY c.codigo
$$;

-- 7.4 Mayor ANALÍTICO de una cuenta: movimientos del período con saldo corrido (ej. fn_mayor_cuenta('1.1.01','2026-11-01','2026-11-30')).
CREATE OR REPLACE FUNCTION fn_mayor_cuenta(p_codigo text, p_desde date, p_hasta date)
RETURNS TABLE (fecha date, numero_asiento bigint, concepto text, debe numeric, haber numeric, saldo numeric)
LANGUAGE sql STABLE AS $$
    WITH c AS (SELECT id, fn_naturaleza_cuenta(tipo) AS nat FROM plan_cuentas WHERE codigo = p_codigo),
    ini AS (SELECT COALESCE(sum(CASE WHEN c.nat = 'DEUDORA' THEN d.debe - d.haber ELSE d.haber - d.debe END), 0) AS s
              FROM c LEFT JOIN asiento_detalle d ON d.cuenta_id = c.id LEFT JOIN asientos a ON a.id = d.asiento_id AND a.fecha < p_desde
             WHERE a.id IS NOT NULL OR d.id IS NULL)
    SELECT a.fecha, a.numero_asiento, a.concepto, d.debe, d.haber,
           (SELECT s FROM ini) + sum(CASE WHEN c.nat = 'DEUDORA' THEN d.debe - d.haber ELSE d.haber - d.debe END) OVER (ORDER BY a.fecha, a.numero_asiento, d.id)
      FROM c JOIN asiento_detalle d ON d.cuenta_id = c.id JOIN asientos a ON a.id = d.asiento_id
     WHERE a.fecha BETWEEN p_desde AND p_hasta ORDER BY a.fecha, a.numero_asiento, d.id
$$;
