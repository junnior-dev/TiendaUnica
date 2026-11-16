-- =============================================================================
--  38 · PRESENTACIONES DE VENTA · vender el mismo producto por unidad, caja, juego… (multiinquilino)
-- =============================================================================
--  Requiere: 23 (unidades), 24 (fn_registrar_venta), 31 (multiinquilino). Va DESPUÉS de 36/37. Idempotente.
--
--  Pedido del dueño: al agregar un producto en el POS poder ELEGIR cómo se vende (unidad suelta, caja × 12, juego…).
--  Regla que NO cambia: el inventario (stock, kardex, costo) vive SIEMPRE en la unidad base del producto (la pieza).
--   · producto_presentaciones: cada fila es una forma de vender el producto: nombre, piezas que trae (factor),
--     precio propio opcional (NULL = precio de la pieza × factor) y código de barras propio opcional (el de la caja).
--     La «unidad» suelta no necesita fila: es el producto mismo.
--   · detalle_venta guarda la presentación vendida (código, factor, cantidad y precio de la presentación). La columna
--     cantidad sigue en PIEZAS (así el stock, el kardex, las devoluciones y el costo de ventas no cambian); el total
--     de la línea se calcula con cantidad_presentacion × precio_presentacion (exacto, sin redondear el precio por pieza).
--   · fn_registrar_venta y fn_cotizar_venta aceptan "presentacion_id" opcional en cada ítem; sin él se vende la pieza como siempre.
--   · IVA, IGTF, tasa y contabilidad no cambian: el trigger de la línea sigue siendo la única fuente de verdad.
-- =============================================================================
SET search_path = tienda, public;

CREATE TABLE IF NOT EXISTS producto_presentaciones (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    negocio_id     integer       NOT NULL REFERENCES negocio(id),
    producto_id    bigint        NOT NULL REFERENCES productos(id),
    codigo         varchar(10)   NOT NULL CHECK (codigo ~ '^[A-Z0-9]+$'),
    nombre         varchar(60)   NOT NULL CHECK (length(trim(nombre)) > 0),
    factor         numeric(14,3) NOT NULL CHECK (factor > 0 AND factor <> 1),
    precio_usd     numeric(18,4) CHECK (precio_usd IS NULL OR precio_usd > 0),
    codigo_barras  varchar(40),
    activa         boolean       NOT NULL DEFAULT true,
    created_at     timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_presentacion ON producto_presentaciones (negocio_id, producto_id, codigo);
CREATE UNIQUE INDEX IF NOT EXISTS uq_neg_presentacion_barras ON producto_presentaciones (negocio_id, codigo_barras) WHERE codigo_barras IS NOT NULL AND activa;
CREATE INDEX IF NOT EXISTS ix_presentacion_producto ON producto_presentaciones (negocio_id, producto_id) WHERE activa;
COMMENT ON TABLE  producto_presentaciones IS 'Formas de vender un producto (caja × 12, juego…). El inventario sigue en la unidad base; factor = piezas por presentación.';
COMMENT ON COLUMN producto_presentaciones.precio_usd IS 'Precio de UNA presentación (USD, sin IVA si los precios no lo incluyen). NULL = precio de la pieza × factor.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='tienda' AND table_name='detalle_venta' AND column_name='presentacion_id') THEN
        ALTER TABLE tienda.detalle_venta
            ADD COLUMN presentacion_id bigint REFERENCES tienda.producto_presentaciones(id),
            ADD COLUMN presentacion_codigo varchar(10),
            ADD COLUMN presentacion_factor numeric(14,3),
            ADD COLUMN cantidad_presentacion numeric(14,3),
            ADD COLUMN precio_presentacion_usd numeric(18,4);
    END IF;
END $$;
COMMENT ON COLUMN detalle_venta.cantidad_presentacion IS 'Si se vendió por presentación: cuántas presentaciones (cajas, juegos). cantidad queda en piezas.';

-- Valida la presentación y devuelve lo que necesita la línea: factor y precio de UNA presentación.
CREATE OR REPLACE FUNCTION fn_presentacion_linea(p_presentacion_id bigint, p_producto_id bigint,
    OUT codigo text, OUT nombre text, OUT factor numeric, OUT precio_usd numeric)
LANGUAGE plpgsql STABLE AS $$
DECLARE r producto_presentaciones; p productos;
BEGIN
    SELECT * INTO r FROM producto_presentaciones WHERE id = p_presentacion_id AND negocio_id = fn_negocio_actual();
    IF r.id IS NULL OR r.producto_id <> p_producto_id THEN
        RAISE EXCEPTION 'La presentación elegida no existe o no pertenece a este producto' USING ERRCODE = 'TV006'; END IF;
    IF NOT r.activa THEN RAISE EXCEPTION 'La presentación «%» está desactivada', r.nombre USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO p FROM productos WHERE id = p_producto_id;
    codigo := r.codigo; nombre := r.nombre; factor := r.factor;
    precio_usd := COALESCE(r.precio_usd, ROUND(p.precio_venta_usd * r.factor, 4));
END $$;

-- Crear o editar una presentación (p_id NULL = nueva). El código de barras no puede repetirse con un producto ni con otra presentación.
CREATE OR REPLACE FUNCTION fn_presentacion_guardar(p_producto_id bigint, p_codigo text, p_nombre text, p_factor numeric,
    p_precio_usd numeric DEFAULT NULL, p_barras text DEFAULT NULL, p_id bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; cod text := upper(trim(COALESCE(p_codigo, ''))); bar text := NULLIF(trim(COALESCE(p_barras, '')), '');
BEGIN
    IF NOT EXISTS (SELECT 1 FROM productos WHERE id = p_producto_id AND negocio_id = fn_negocio_actual()) THEN
        RAISE EXCEPTION 'El producto no existe' USING ERRCODE = 'TV006'; END IF;
    IF cod !~ '^[A-Z0-9]{1,10}$' THEN RAISE EXCEPTION 'El código de la presentación va en letras o números, sin espacios (ej. CAJA12)' USING ERRCODE = 'TV006'; END IF;
    IF COALESCE(p_factor, 0) <= 0 OR p_factor = 1 THEN RAISE EXCEPTION 'Piezas por presentación debe ser mayor que cero y distinto de 1 (la pieza suelta ya existe)' USING ERRCODE = 'TV006'; END IF;
    IF p_precio_usd IS NOT NULL AND p_precio_usd <= 0 THEN RAISE EXCEPTION 'El precio de la presentación debe ser mayor que cero (o déjalo vacío para usar precio × piezas)' USING ERRCODE = 'TV006'; END IF;
    IF bar IS NOT NULL AND (EXISTS (SELECT 1 FROM productos WHERE codigo_barras = bar AND negocio_id = fn_negocio_actual())
        OR EXISTS (SELECT 1 FROM producto_presentaciones WHERE codigo_barras = bar AND activa AND negocio_id = fn_negocio_actual() AND id IS DISTINCT FROM p_id)) THEN
        RAISE EXCEPTION 'El código de barras % ya lo usa otro producto o presentación', bar USING ERRCODE = 'TV006'; END IF;
    IF p_id IS NULL THEN
        INSERT INTO producto_presentaciones (producto_id, codigo, nombre, factor, precio_usd, codigo_barras)
        VALUES (p_producto_id, cod, trim(p_nombre), p_factor, p_precio_usd, bar) RETURNING id INTO v_id;
    ELSE
        UPDATE producto_presentaciones SET codigo = cod, nombre = trim(p_nombre), factor = p_factor, precio_usd = p_precio_usd, codigo_barras = bar, activa = true
         WHERE id = p_id AND producto_id = p_producto_id AND negocio_id = fn_negocio_actual() RETURNING id INTO v_id;
        IF v_id IS NULL THEN RAISE EXCEPTION 'La presentación no existe' USING ERRCODE = 'TV006'; END IF;
    END IF;
    RETURN v_id;
END $$;

-- Las presentaciones no se borran (las ventas ya hechas las referencian): se desactivan.
CREATE OR REPLACE FUNCTION fn_presentacion_desactivar(p_id bigint) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE producto_presentaciones SET activa = false WHERE id = p_id AND negocio_id = fn_negocio_actual();
    IF NOT FOUND THEN RAISE EXCEPTION 'La presentación no existe' USING ERRCODE = 'TV006'; END IF;
END $$;

-- ── Cotización, línea y registro con presentación (versiones de 02/03/24 con UNA novedad: presentacion_id) ──
CREATE OR REPLACE FUNCTION fn_cotizar_venta(
    p_items jsonb,
    OUT tasa_cambio numeric, OUT tasa_fecha_valor date, OUT iva_pct numeric,
    OUT base_usd numeric, OUT exento_usd numeric, OUT iva_usd numeric, OUT total_usd numeric,
    OUT base_ves numeric, OUT exento_ves numeric, OUT iva_ves numeric, OUT total_ves numeric,
    OUT cobra_igtf boolean, OUT igtf_pct numeric, OUT igtf_base text)
LANGUAGE plpgsql STABLE AS $$
DECLARE t tasas_cambio; n negocio; it record; p productos; l record; pr record; v_cant numeric; v_precio numeric;
BEGIN
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Agregue al menos un producto' USING ERRCODE = 'TV006';
    END IF;
    SELECT * INTO n FROM negocio WHERE id = fn_negocio_actual();
    t := fn_tasa_aplicable(); tasa_cambio := t.tasa; tasa_fecha_valor := t.fecha_valor;
    iva_pct := fn_iva_pct();
    cobra_igtf := COALESCE(n.cobra_igtf, false);
    igtf_pct := CASE WHEN cobra_igtf THEN fn_igtf_pct() ELSE 0 END;
    igtf_base := n.igtf_base;
    base_usd := 0; exento_usd := 0; iva_usd := 0; total_usd := 0; base_ves := 0; exento_ves := 0; iva_ves := 0; total_ves := 0;

    FOR it IN SELECT * FROM jsonb_to_recordset(p_items) AS x(producto_id bigint, cantidad numeric, descuento_pct numeric, presentacion_id bigint) LOOP
        SELECT * INTO p FROM productos WHERE id = it.producto_id;
        IF p.id IS NULL THEN RAISE EXCEPTION 'El producto % no existe', it.producto_id USING ERRCODE = 'TV006'; END IF;
        v_cant := it.cantidad; v_precio := p.precio_venta_usd;
        IF it.presentacion_id IS NOT NULL THEN
            SELECT * INTO pr FROM fn_presentacion_linea(it.presentacion_id, it.producto_id);
            v_precio := pr.precio_usd;
        END IF;
        SELECT * INTO l FROM fn_calcular_linea_venta(v_cant, v_precio, COALESCE(it.descuento_pct, 0), p.exento_iva OR p.exonerado_iva, iva_pct, n.precios_incluyen_iva, tasa_cambio);
        IF p.exento_iva OR p.exonerado_iva THEN
            exento_usd := exento_usd + l.base_usd; exento_ves := exento_ves + l.base_ves;
        ELSE
            base_usd := base_usd + l.base_usd; base_ves := base_ves + l.base_ves;
        END IF;
        iva_usd := iva_usd + l.iva_usd; iva_ves := iva_ves + l.iva_ves;
        total_usd := total_usd + l.total_usd; total_ves := total_ves + l.total_ves;
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION trg_detalle_venta_antes() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v ventas; p productos; l record; pr record; v_cant numeric; v_precio numeric;
BEGIN
    SELECT * INTO v FROM ventas WHERE id = NEW.venta_id;
    IF v.id IS NULL OR v.creada_txid <> pg_current_xact_id() OR v.estado <> 'COMPLETADA' THEN
        RAISE EXCEPTION 'Las líneas solo se agregan en la misma transacción que crea la venta' USING ERRCODE = 'TV005';
    END IF;
    IF EXISTS (SELECT 1 FROM pagos_venta WHERE venta_id = NEW.venta_id) THEN
        RAISE EXCEPTION 'No se pueden agregar productos después de registrar pagos' USING ERRCODE = 'TV005';
    END IF;
    SELECT * INTO p FROM productos WHERE id = NEW.producto_id FOR UPDATE;   -- bloquea ANTES de que el FK tome su bloqueo compartido (evita interbloqueo)
    IF p.id IS NULL OR NOT p.activo THEN RAISE EXCEPTION 'El producto % no existe o está inactivo', NEW.producto_id USING ERRCODE = 'TV006'; END IF;
    IF p.precio_venta_usd <= 0 THEN RAISE EXCEPTION 'El producto "%" no tiene precio de venta', p.nombre USING ERRCODE = 'TV006'; END IF;

    NEW.descripcion := COALESCE(NEW.descripcion, p.nombre);
    v_cant := NEW.cantidad; v_precio := p.precio_venta_usd;
    IF NEW.presentacion_id IS NOT NULL THEN
        -- Venta por presentación: NEW.cantidad llega en presentaciones; el stock y el kardex siempre en piezas.
        SELECT * INTO pr FROM fn_presentacion_linea(NEW.presentacion_id, NEW.producto_id);
        NEW.cantidad_presentacion := NEW.cantidad;
        NEW.presentacion_codigo := pr.codigo;
        NEW.presentacion_factor := pr.factor;
        NEW.precio_presentacion_usd := pr.precio_usd;
        NEW.cantidad := ROUND(v_cant * pr.factor, 3);
        v_precio := pr.precio_usd;
        NEW.descripcion := COALESCE(NEW.descripcion, p.nombre) || ' — ' || pr.nombre;
    END IF;
    NEW.precio_unitario_usd := CASE WHEN NEW.presentacion_id IS NULL THEN p.precio_venta_usd ELSE ROUND(v_precio / NEW.presentacion_factor, 4) END;
    NEW.costo_unitario_usd := p.costo_usd;
    NEW.exento := p.exento_iva OR p.exonerado_iva;
    NEW.alicuota_codigo := CASE WHEN p.exento_iva THEN 'EXENTO' WHEN p.exonerado_iva THEN 'EXONERADO' ELSE 'IVA_GENERAL' END;
    NEW.iva_pct := CASE WHEN NEW.exento THEN 0 ELSE v.iva_pct END;
    SELECT * INTO l FROM fn_calcular_linea_venta(v_cant, v_precio, NEW.descuento_pct, NEW.exento,
                                                  v.iva_pct, v.precios_incluyen_iva, v.tasa_cambio);
    NEW.base_usd := l.base_usd; NEW.iva_usd := l.iva_usd; NEW.total_usd := l.total_usd;
    NEW.base_ves := l.base_ves; NEW.iva_ves := l.iva_ves; NEW.total_ves := l.total_ves;
    RETURN NEW;
END $$;

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

    FOR it IN SELECT * FROM jsonb_to_recordset(p_items) AS x(producto_id bigint, cantidad numeric, descuento_pct numeric, presentacion_id bigint) LOOP
        INSERT INTO detalle_venta (venta_id, producto_id, cantidad, descuento_pct, presentacion_id)
        VALUES (v_id, it.producto_id, it.cantidad, COALESCE(it.descuento_pct, 0), it.presentacion_id);
    END LOOP;

    FOR pg IN SELECT * FROM jsonb_to_recordset(p_pagos) AS x(metodo_pago_id bigint, monto numeric, referencia text, monto_entregado numeric, vuelto_monto numeric, vuelto_moneda text, es_anticipo boolean) LOOP
        INSERT INTO pagos_venta (venta_id, metodo_pago_id, monto, referencia, monto_entregado, vuelto_monto, vuelto_moneda, es_anticipo)
        VALUES (v_id, pg.metodo_pago_id, pg.monto, pg.referencia, pg.monto_entregado, pg.vuelto_monto, pg.vuelto_moneda, COALESCE(pg.es_anticipo, false));
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

-- ── Tienda única: sello de negocio (negocio_id = 1), sin RLS ──
DO $$
DECLARE t text := 'producto_presentaciones';
BEGIN
    EXECUTE format('DROP TRIGGER IF EXISTS trg_sello_negocio ON tienda.%I', t);
    EXECUTE format('CREATE TRIGGER trg_sello_negocio BEFORE INSERT ON tienda.%I FOR EACH ROW EXECUTE FUNCTION fn_sello_negocio()', t);
    EXECUTE format('ALTER TABLE tienda.%I ALTER COLUMN negocio_id SET DEFAULT 1', t);
END $$;
