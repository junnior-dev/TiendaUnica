-- =============================================================================
--  24 · ENCARGOS DE PIEZAS SIN STOCK (el flujo más común de un repuesto)
-- =============================================================================
--  Requiere: 10, 14, 15, 16 (caja y ventas a crédito). Es idempotente:
--     psql -d tienda -v ON_ERROR_STOP=1 -f 24_encargos.sql
--
--  Qué resuelve: el cliente pide un repuesto que no hay en la tienda. Antes se anotaba en papel;
--  aquí queda registrado con su ANTICIPO en la caja, su ESTADO y la VENTA al entregarlo.
--
--  Ciclo de vida (estados):
--     SOLICITADO → ORDENADO → RECIBIDO → AVISADO → ENTREGADO
--         (o CANCELADO desde cualquier estado antes de entregar; ANULADO solo si fue un error de registro)
--     · SOLICITADO  el cliente encarga la pieza.
--     · ORDENADO    se pidió al proveedor (opcional: orden de compra del archivo 26).
--     · RECIBIDO    llegó la pieza (ya está en el inventario para venderla).
--     · AVISADO     se le avisó al cliente (teléfono/WhatsApp).
--     · ENTREGADO   se cobró el resto y se registró la VENTA (fn_entregar_encargo crea la venta con
--                   los anticipos aplicados como pagos marcados es_anticipo).
--
--  DINERO (para que la caja siempre cuadre):
--     · Cada anticipo entra a la gaveta del turno con un INGRESO de caja (origen ENCARGO).
--     · Al entregar, el anticipo se aplica como un pago de la venta marcado es_anticipo = TRUE:
--       los conteos de efectivo NO lo vuelven a contar (ese billete ya entró con el anticipo);
--       las sumas de lo vendido SÍ lo incluyen porque la venta es real.
--     · El anticipo se guarda con la tasa congelada del día que se cobró; al entregar su valor en
--       USD se recalcula con la tasa de la venta (un anticipo en Bs vale lo que valga ese día).
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  1. TABLAS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS encargos (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- el id ES el número: «Encargo 12»
    cliente_id      bigint      NOT NULL REFERENCES clientes(id),
    producto_id     bigint      REFERENCES productos(id),         -- NULL = pieza que aún no está en el catálogo
    moto_modelo_id  bigint      REFERENCES motos_modelos(id),     -- opcional: para qué moto la encargó
    descripcion     text        NOT NULL,                         -- qué pidió (marca, medida, color…)
    cantidad        numeric(14,3) NOT NULL DEFAULT 1 CHECK (cantidad > 0),
    precio_estimado_usd numeric(18,2),
    estado          varchar(10) NOT NULL DEFAULT 'SOLICITADO'
                    CHECK (estado IN ('SOLICITADO','ORDENADO','RECIBIDO','AVISADO','ENTREGADO','CANCELADO','ANULADO')),
    nota_proveedor  text,                                         -- a quién se pidió y con qué referencia
    venta_id        bigint      REFERENCES ventas(id),            -- la venta que se generó al entregarlo
    observaciones   text,
    usuario_id      bigint      NOT NULL REFERENCES usuarios(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    fecha_orden     date, fecha_llegada date, fecha_aviso date, fecha_entrega date,
    cancelado_en    timestamptz, motivo_cancelacion text,
    CONSTRAINT ck_encargo_estado_fechas CHECK (
        (fecha_orden    IS NULL OR estado IN ('ORDENADO','RECIBIDO','AVISADO','ENTREGADO','CANCELADO')) AND
        (fecha_llegada  IS NULL OR estado IN ('RECIBIDO','AVISADO','ENTREGADO','CANCELADO')) AND
        (fecha_aviso    IS NULL OR estado IN ('AVISADO','ENTREGADO','CANCELADO')) AND
        (fecha_entrega  IS NULL OR estado = 'ENTREGADO') AND
        (estado <> 'ENTREGADO' OR venta_id IS NOT NULL) AND
        (estado NOT IN ('CANCELADO','ANULADO') OR motivo_cancelacion IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_encargos_estado ON encargos (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_encargos_cliente ON encargos (cliente_id) WHERE estado NOT IN ('ENTREGADO','CANCELADO','ANULADO');
COMMENT ON TABLE  encargos IS 'Encargo de una pieza que no hay en stock: quién la pidió, qué es, cuánto dejó de anticipo y en qué estado va. La entrega se convierte en venta.';
COMMENT ON COLUMN encargos.producto_id IS 'Producto del catálogo encargado. NULL si la pieza no está en el catálogo (la app pide crearla antes de entregar).';
COMMENT ON COLUMN encargos.precio_estimado_usd IS 'Precio pactado con el cliente (referencia). La venta real congela el precio vigente del producto.';
COMMENT ON COLUMN encargos.venta_id IS 'Venta generada por la entrega (estado ENTREGADO). Los anticipos quedaron aplicados como pagos es_anticipo de esa venta.';

CREATE TABLE IF NOT EXISTS encargos_pagos (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    encargo_id   bigint        NOT NULL REFERENCES encargos(id),
    metodo_pago_id bigint      NOT NULL REFERENCES metodos_pago(id),
    moneda       char(3)       NOT NULL REFERENCES monedas(codigo),
    monto        numeric(18,2) NOT NULL CHECK (monto > 0),      -- en la moneda del método
    monto_usd    numeric(18,2) NOT NULL CHECK (monto_usd >= 0), -- valor del día del anticipo (congelado al cobrarlo)
    monto_ves    numeric(18,2) NOT NULL CHECK (monto_ves >= 0),
    tasa_usd     numeric(20,8) NOT NULL CHECK (tasa_usd > 0),   -- tasa VES/USD del día del anticipo
    referencia   varchar(60),
    movimiento_caja_id bigint REFERENCES movimientos_caja(id), -- el ingreso del anticipo en la gaveta
    usuario_id   bigint        NOT NULL REFERENCES usuarios(id),
    created_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_encargos_pagos ON encargos_pagos (encargo_id);
COMMENT ON TABLE encargos_pagos IS 'Anticipos de un encargo. Cada anticipo es también un INGRESO de caja (origen ENCARGO) para que el arqueo cuadre.';
COMMENT ON COLUMN encargos_pagos.monto_usd IS 'Valor en USD del anticipo el día que se cobró (tasa congelada). Al entregar el encargo, su valor para la venta se recalcula con la tasa de ese día.';

-- Guardia del encargo: los datos fijos no se editan; solo se mueve el estado (y la venta al entregarlo).
CREATE OR REPLACE FUNCTION trg_encargos_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o jsonb; n jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Un encargo no se borra: cancélalo' USING ERRCODE = 'TV005'; END IF;
    o := to_jsonb(OLD) - 'estado' - 'fecha_orden' - 'fecha_llegada' - 'fecha_aviso' - 'fecha_entrega' - 'venta_id'
                    - 'cancelado_en' - 'motivo_cancelacion' - 'observaciones' - 'nota_proveedor' - 'updated_at';
    n := to_jsonb(NEW) - 'estado' - 'fecha_orden' - 'fecha_llegada' - 'fecha_aviso' - 'fecha_entrega' - 'venta_id'
                    - 'cancelado_en' - 'motivo_cancelacion' - 'observaciones' - 'nota_proveedor' - 'updated_at';
    IF o <> n THEN RAISE EXCEPTION 'Los datos del encargo no se editan después de crearlo: cancélalo y crea uno nuevo' USING ERRCODE = 'TV005'; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_encargos_guardia ON encargos;
CREATE TRIGGER trg_encargos_guardia BEFORE UPDATE OR DELETE ON encargos FOR EACH ROW EXECUTE FUNCTION trg_encargos_guardia();
DROP TRIGGER IF EXISTS trg_encargos_updated ON encargos;
CREATE TRIGGER trg_encargos_updated BEFORE UPDATE ON encargos FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Los anticipos tampoco se editan: se corrigen anulando el encargo o con un egreso manual de caja.
CREATE OR REPLACE FUNCTION trg_encargos_pagos_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Un anticipo no se modifica ni se elimina: cancela el encargo o registra un egreso manual en caja' USING ERRCODE = 'TV005';
END $$;
DROP TRIGGER IF EXISTS trg_encargos_pagos_inmutable ON encargos_pagos;
CREATE TRIGGER trg_encargos_pagos_inmutable BEFORE UPDATE OR DELETE ON encargos_pagos
    FOR EACH ROW EXECUTE FUNCTION trg_encargos_pagos_inmutable();

-- ---------------------------------------------------------------------------
--  2. CAJA: el anticipo es dinero que entra a la gaveta
-- ---------------------------------------------------------------------------
ALTER TABLE movimientos_caja DROP CONSTRAINT IF EXISTS movimientos_caja_origen_check;
ALTER TABLE movimientos_caja ADD CONSTRAINT movimientos_caja_origen_check
    CHECK (origen IN ('MANUAL','COBRO_CXC','ANULACION_COBRO','NOTA_CREDITO','ENCARGO'));

-- Pago de una venta con anticipo aplicado: NO se vuelve a contar en la gaveta (ya entró con el anticipo).
ALTER TABLE pagos_venta ADD COLUMN IF NOT EXISTS es_anticipo boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN pagos_venta.es_anticipo IS 'TRUE si este pago es un anticipo de encargo ya cobrado antes (archivo 24): no suma al efectivo esperado de la caja porque entró a la gaveta el día del anticipo.';

-- ---------------------------------------------------------------------------
--  3. FUNCIONES
-- ---------------------------------------------------------------------------
-- Crea el encargo. El cliente es obligatorio (un encargo anónimo no se puede avisar ni entregar).
CREATE OR REPLACE FUNCTION fn_crear_encargo(
    p_cliente_id bigint, p_descripcion text, p_cantidad numeric DEFAULT 1, p_producto_id bigint DEFAULT NULL,
    p_precio_estimado_usd numeric DEFAULT NULL, p_moto_modelo_id bigint DEFAULT NULL, p_usuario_id bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM clientes WHERE id = p_cliente_id AND activo) THEN
        RAISE EXCEPTION 'Elige el cliente que encarga la pieza' USING ERRCODE = 'TV006'; END IF;
    IF p_descripcion IS NULL OR length(trim(p_descripcion)) < 3 THEN
        RAISE EXCEPTION 'Describe la pieza encargada (marca, medida, modelo de moto…)' USING ERRCODE = 'TV006'; END IF;
    IF COALESCE(p_cantidad, 1) <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF p_precio_estimado_usd IS NOT NULL AND p_precio_estimado_usd < 0 THEN
        RAISE EXCEPTION 'El precio estimado no puede ser negativo' USING ERRCODE = 'TV006'; END IF;
    IF p_producto_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM productos WHERE id = p_producto_id) THEN
        RAISE EXCEPTION 'El producto indicado no existe' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO encargos (cliente_id, producto_id, moto_modelo_id, descripcion, cantidad, precio_estimado_usd, usuario_id)
    VALUES (p_cliente_id, p_producto_id, p_moto_modelo_id, trim(p_descripcion), COALESCE(p_cantidad, 1), p_precio_estimado_usd, COALESCE(p_usuario_id, fn_usuario_sesion()))
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;
COMMENT ON FUNCTION fn_crear_encargo(bigint, text, numeric, bigint, numeric, bigint, bigint) IS 'Registra un encargo de pieza sin stock (estado SOLICITADO).';

-- Cobra un anticipo: filas en encargos_pagos + INGRESO de caja (efectivo) o registro sin efectivo (Zelle/POS).
-- Devuelve el id del anticipo. Dentro del turno abierto de quien cobra (obligatorio: es dinero real).
CREATE OR REPLACE FUNCTION fn_cobrar_anticipo_encargo(
    p_encargo_id bigint, p_metodo_pago_id bigint, p_monto numeric, p_usuario_id bigint, p_referencia text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE e encargos; m metodos_pago; ya numeric; t_usd numeric; t_ves numeric; mov bigint; v_id bigint;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('tienda.encargo.' || p_encargo_id));
    SELECT * INTO e FROM encargos WHERE id = p_encargo_id FOR UPDATE;
    IF e.id IS NULL THEN RAISE EXCEPTION 'El encargo no existe' USING ERRCODE = 'TV006'; END IF;
    IF e.estado IN ('ENTREGADO','CANCELADO','ANULADO') THEN
        RAISE EXCEPTION 'Ese encargo está %: no admite anticipos', e.estado USING ERRCODE = 'TV005'; END IF;
    SELECT * INTO m FROM metodos_pago WHERE id = p_metodo_pago_id AND activo;
    IF m.id IS NULL THEN RAISE EXCEPTION 'Elige el método del anticipo' USING ERRCODE = 'TV006'; END IF;
    IF m.requiere_referencia AND length(trim(COALESCE(p_referencia, ''))) = 0 THEN
        RAISE EXCEPTION 'El método "%" necesita el número de referencia', m.nombre USING ERRCODE = 'TV006'; END IF;
    IF p_monto IS NULL OR p_monto <= 0 THEN RAISE EXCEPTION 'El anticipo debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    SELECT COALESCE(sum(monto_usd), 0) INTO ya FROM encargos_pagos WHERE encargo_id = p_encargo_id;
    IF ya + 0.005 > COALESCE(e.precio_estimado_usd, 1e9) THEN
        RAISE EXCEPTION 'Los anticipos (USD %) superan el precio estimado (USD %) del encargo', ROUND(ya + 0.005, 2), e.precio_estimado_usd USING ERRCODE = 'TV006';
    END IF;
    t_usd := fn_tasa_par(m.moneda, 'USD', fn_hoy());
    t_ves := fn_tasa_par(m.moneda, 'VES', fn_hoy());
    mov := fn_registrar_movimiento_caja(p_usuario_id, 'INGRESO',
            'Anticipo de encargo N.º ' || e.id || ' · ' || (SELECT nombre FROM clientes WHERE id = e.cliente_id),
            m.moneda, p_monto, p_referencia, 'ENCARGO', NULL, m.es_efectivo, true, NULL);
    INSERT INTO encargos_pagos (encargo_id, metodo_pago_id, moneda, monto, monto_usd, monto_ves, tasa_usd, referencia, movimiento_caja_id, usuario_id)
    VALUES (p_encargo_id, p_metodo_pago_id, m.moneda, ROUND(p_monto, 2),
            ROUND(p_monto * t_usd, 2), ROUND(p_monto * t_ves, 2), fn_tasa_par('USD', 'VES', fn_hoy()),
            NULLIF(trim(p_referencia), ''), mov, p_usuario_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;
COMMENT ON FUNCTION fn_cobrar_anticipo_encargo(bigint, bigint, numeric, bigint, text) IS 'Cobra un anticipo del encargo: encargos_pagos + ingreso de caja del turno. Exige caja abierta.';

-- Cambia el estado con las transiciones válidas. p_fecha NULL = hoy.
CREATE OR REPLACE FUNCTION fn_cambiar_estado_encargo(p_encargo_id bigint, p_estado text, p_usuario_id bigint, p_nota text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE e encargos; permitidos text;
BEGIN
    SELECT * INTO e FROM encargos WHERE id = p_encargo_id FOR UPDATE;
    IF e.id IS NULL THEN RAISE EXCEPTION 'El encargo no existe' USING ERRCODE = 'TV006'; END IF;
    permitidos := CASE e.estado
        WHEN 'SOLICITADO' THEN 'ORDENADO,RECIBIDO,CANCELADO,ANULADO'
        WHEN 'ORDENADO'   THEN 'RECIBIDO,CANCELADO'
        WHEN 'RECIBIDO'   THEN 'AVISADO,ENTREGADO,CANCELADO'
        WHEN 'AVISADO'    THEN 'ENTREGADO,CANCELADO'
        ELSE '' END;
    IF e.estado = 'ENTREGADO' THEN RAISE EXCEPTION 'El encargo ya fue entregado (venta %)', e.venta_id USING ERRCODE = 'TV005'; END IF;
    IF e.estado IN ('CANCELADO','ANULADO') THEN RAISE EXCEPTION 'El encargo ya está %', e.estado USING ERRCODE = 'TV005'; END IF;
    IF p_estado IS NULL OR position(p_estado in permitidos) = 0 THEN
        RAISE EXCEPTION 'No puedes pasar un encargo % a % (estados válidos desde ahí: %)', e.estado, COALESCE(p_estado, '∅'), permitidos USING ERRCODE = 'TV006';
    END IF;
    IF p_estado = 'ENTREGADO' THEN
        RAISE EXCEPTION 'La entrega se hace con fn_entregar_encargo (crea la venta y aplica los anticipos)' USING ERRCODE = 'TV006';
    END IF;
    IF p_estado IN ('CANCELADO','ANULADO') AND length(trim(COALESCE(p_nota, ''))) < 3 THEN
        RAISE EXCEPTION 'Indica el motivo de la %', lower(p_estado) USING ERRCODE = 'TV006'; END IF;
    IF p_estado = 'ANULADO' AND EXISTS (SELECT 1 FROM encargos_pagos WHERE encargo_id = p_encargo_id) THEN
        RAISE EXCEPTION 'El encargo tiene anticipos cobrados: cáncelalo con su motivo y devuelve el anticipo con un egreso de caja' USING ERRCODE = 'TV005';
    END IF;
    UPDATE encargos SET estado = p_estado,
        fecha_orden    = CASE WHEN p_estado = 'ORDENADO' THEN COALESCE(fecha_orden, fn_hoy()) ELSE fecha_orden END,
        fecha_llegada  = CASE WHEN p_estado = 'RECIBIDO' THEN COALESCE(fecha_llegada, fn_hoy()) ELSE fecha_llegada END,
        fecha_aviso    = CASE WHEN p_estado = 'AVISADO'  THEN COALESCE(fecha_aviso, fn_hoy()) ELSE fecha_aviso END,
        cancelado_en   = CASE WHEN p_estado IN ('CANCELADO','ANULADO') THEN now() ELSE cancelado_en END,
        motivo_cancelacion = CASE WHEN p_estado IN ('CANCELADO','ANULADO') THEN trim(p_nota) ELSE motivo_cancelacion END,
        nota_proveedor = CASE WHEN p_estado = 'ORDENADO' THEN COALESCE(NULLIF(trim(p_nota), ''), nota_proveedor) ELSE nota_proveedor END
      WHERE id = p_encargo_id;
END $$;
COMMENT ON FUNCTION fn_cambiar_estado_encargo(bigint, text, bigint, text) IS 'Transición de estado del encargo. La entrega (ENTREGADO) solo por fn_entregar_encargo.';

-- Registro de venta (igual al del 16) con UNA novedad del 24: cada pago puede venir marcado
-- «es_anticipo» (anticipo de encargo ya cobrado que se aplica al entregar). Sin ese campo, la
-- entrega no podría decirle al Corte Z que ese dinero ya está en la gaveta desde el anticipo.
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

-- ENTREGA: crea la venta (línea del producto con su precio vigente), aplica los anticipos como pagos
-- es_anticipo y suma los pagos nuevos del cliente. Todo en una transacción: si falla, nada cambia.
--   p_pagos: [{"metodo_pago_id":3,"monto":50.00,"referencia":"..."}]  → el RESTO que el cliente paga ahora.
-- El precio del producto lo fija la base (precio vigente); el descuento se puede indicar por línea.
CREATE OR REPLACE FUNCTION fn_entregar_encargo(
    p_encargo_id bigint, p_pagos jsonb, p_usuario_id bigint, p_descuento_pct numeric DEFAULT NULL,
    p_tipo_emision text DEFAULT 'PRESENCIAL', p_observaciones text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE e encargos; p productos; v_id bigint; ap record; ya_usd numeric;
        pagado_usd numeric; tol numeric; cot record; pagos_final jsonb := '[]'::jsonb;
        mp varchar;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('tienda.encargo.' || p_encargo_id));
    SELECT * INTO e FROM encargos WHERE id = p_encargo_id FOR UPDATE;
    IF e.id IS NULL THEN RAISE EXCEPTION 'El encargo no existe' USING ERRCODE = 'TV006'; END IF;
    IF e.estado NOT IN ('RECIBIDO','AVISADO') THEN
        RAISE EXCEPTION 'Solo se entrega un encargo RECIBIDO o AVISADO (este está %)', e.estado USING ERRCODE = 'TV005'; END IF;
    IF e.producto_id IS NULL THEN
        RAISE EXCEPTION 'La pieza encargada no está en el catálogo: crea el producto y asócialo al encargo antes de entregar' USING ERRCODE = 'TV006';
    END IF;
    SELECT * INTO p FROM productos WHERE id = e.producto_id;
    IF NOT p.activo OR p.precio_venta_usd <= 0 THEN
        RAISE EXCEPTION 'El producto "%" está inactivo o sin precio: no se puede vender', p.nombre USING ERRCODE = 'TV006'; END IF;

    -- a) los pagos de la entrega: primero los anticipos ya cobrados (es_anticipo = true), luego los nuevos
    FOR ap IN SELECT metodo_pago_id, monto, referencia FROM encargos_pagos WHERE encargo_id = p_encargo_id ORDER BY id LOOP
        pagos_final := pagos_final || jsonb_build_object('metodo_pago_id', ap.metodo_pago_id, 'monto', ap.monto,
            'referencia', 'Anticipo encargo ' || e.id, 'es_anticipo', true);
    END LOOP;
    FOR ap IN SELECT * FROM jsonb_to_recordset(COALESCE(p_pagos, '[]'::jsonb)) AS x(metodo_pago_id bigint, monto numeric, referencia text) LOOP
        IF ap.monto IS NULL OR ap.monto <= 0 THEN RAISE EXCEPTION 'Los pagos nuevos deben ser mayores que cero' USING ERRCODE = 'TV006'; END IF;
        SELECT nombre INTO mp FROM metodos_pago WHERE id = ap.metodo_pago_id AND activo;
        IF mp IS NULL THEN RAISE EXCEPTION 'Uno de los métodos de pago no existe o está inactivo' USING ERRCODE = 'TV006'; END IF;
        pagos_final := pagos_final || jsonb_build_object('metodo_pago_id', ap.metodo_pago_id, 'monto', ap.monto, 'referencia', ap.referencia, 'es_anticipo', false);
    END LOOP;
    IF jsonb_array_length(pagos_final) = 0 THEN
        RAISE EXCEPTION 'El cliente debe pagar algo (anticipo cobrado o pago nuevo): no se entregan piezas a fiado por aquí' USING ERRCODE = 'TV006';
    END IF;

    -- b) cuadre ANTES de registrar la venta (evita quemar el número de venta por un error previsible).
    --    El total sale de fn_cotizar_venta (misma fórmula que la caja) y cada pago se convierte como lo hace el trigger.
    SELECT * INTO cot FROM fn_cotizar_venta(jsonb_build_array(jsonb_build_object('producto_id', e.producto_id, 'cantidad', e.cantidad, 'descuento_pct', COALESCE(p_descuento_pct, 0))));
    SELECT COALESCE(tolerancia_pago_usd, 0.01) INTO tol FROM negocio WHERE id = fn_negocio_actual();
    pagado_usd := 0;
    FOR ap IN SELECT * FROM jsonb_to_recordset(pagos_final) AS x(metodo_pago_id bigint, monto numeric) LOOP
        SELECT moneda INTO mp FROM metodos_pago WHERE id = ap.metodo_pago_id;
        pagado_usd := pagado_usd + CASE trim(mp)
            WHEN 'USD' THEN ap.monto
            WHEN 'VES' THEN ROUND(ap.monto / cot.tasa_cambio, 2)
            ELSE ROUND(ROUND(ap.monto * (fn_tasa_aplicable(cot.tasa_fecha_valor, trim(mp), 'VES')).tasa, 2) / cot.tasa_cambio, 2) END;
    END LOOP;
    IF pagado_usd < cot.total_usd - tol THEN
        SELECT COALESCE(sum(monto_usd), 0) INTO ya_usd FROM encargos_pagos WHERE encargo_id = p_encargo_id;
        RAISE EXCEPTION 'Faltan USD % para completar la entrega (total USD %; anticipos equivalentes hoy USD %)',
            ROUND(cot.total_usd - pagado_usd, 2), cot.total_usd, ya_usd USING ERRCODE = 'TV004';
    END IF;
    IF pagado_usd > cot.total_usd + tol THEN
        RAISE EXCEPTION 'Los pagos (USD %) superan el total de la entrega (USD %): revisa el monto o el descuento', pagado_usd, cot.total_usd USING ERRCODE = 'TV004';
    END IF;

    -- c) la venta, de una sola vez (fn_registrar_venta del 16, con es_anticipo del 24): congela precio, tasa e IVA.
    PERFORM set_config('tienda.usuario_id', COALESCE(p_usuario_id::text, ''), true);
    v_id := fn_registrar_venta(p_usuario_id,
        jsonb_build_array(jsonb_build_object('producto_id', e.producto_id, 'cantidad', e.cantidad,
                                             'descuento_pct', COALESCE(p_descuento_pct, 0))),
        pagos_final, e.cliente_id,
        COALESCE(NULLIF(trim(p_observaciones), ''), 'Entrega de encargo N.º ' || e.id),
        COALESCE(p_tipo_emision, 'PRESENCIAL'));

    UPDATE encargos SET estado = 'ENTREGADO', venta_id = v_id, fecha_entrega = fn_hoy() WHERE id = p_encargo_id;
    RETURN v_id;
END $$;
COMMENT ON FUNCTION fn_entregar_encargo(bigint, jsonb, bigint, numeric, text, text) IS 'Entrega el encargo: crea la venta con la pieza, aplica los anticipos como pagos es_anticipo y registra el resto. Todo o nada.';

-- ---------------------------------------------------------------------------
--  4. CONSULTAS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_encargos AS
SELECT e.id, e.estado, e.descripcion, e.cantidad, e.precio_estimado_usd, e.venta_id,
       c.nombre AS cliente, c.telefono AS cliente_telefono, c.tipo_documento || '-' || c.documento AS documento_cliente,
       p.sku, p.nombre AS producto, p.stock_actual, mm.marca || ' ' || mm.modelo AS moto,
       (SELECT string_agg(DISTINCT trim(ep.moneda), ',' ) FROM encargos_pagos ep WHERE ep.encargo_id = e.id) AS monedas_anticipo,
       COALESCE((SELECT sum(ep.monto_usd) FROM encargos_pagos ep WHERE ep.encargo_id = e.id), 0) AS anticipado_usd,
       COALESCE((SELECT count(*) FROM encargos_pagos ep WHERE ep.encargo_id = e.id), 0) AS n_anticipos,
       e.nota_proveedor, e.observaciones, u.nombre_completo AS por,
       e.created_at, e.fecha_orden, e.fecha_llegada, e.fecha_aviso, e.fecha_entrega,
       (fn_hoy() - (e.created_at AT TIME ZONE 'America/Caracas')::date) AS dias
  FROM encargos e
  JOIN clientes c ON c.id = e.cliente_id
  LEFT JOIN productos p ON p.id = e.producto_id
  LEFT JOIN motos_modelos mm ON mm.id = e.moto_modelo_id
  LEFT JOIN usuarios u ON u.id = e.usuario_id;
COMMENT ON VIEW v_encargos IS 'Encargos con cliente, pieza, anticipos cobrados y días transcurridos. Los abiertos (no ENTREGADO/CANCELADO/ANULADO) son los que hay que perseguir.';

CREATE OR REPLACE VIEW v_encargos_pendientes AS
SELECT * FROM v_encargos WHERE estado IN ('SOLICITADO','ORDENADO','RECIBIDO','AVISADO') ORDER BY created_at;
COMMENT ON VIEW v_encargos_pendientes IS 'Encargos abiertos por antigüedad (los más viejos primero): qué avisar y qué cobrar al entregar.';

-- ---------------------------------------------------------------------------
--  5. CORTE X / Z: los anticipos aplicados en ventas no se vuelven a contar
-- ---------------------------------------------------------------------------
--  Reemplaza a fn_resumen_apertura (archivo 16) con un cambio mínimo: el efectivo recibido de los pagos
--  con es_anticipo no entra en la gaveta (ese dinero entró el día del anticipo como INGRESO de caja).
--  En «metodos» siguen apareciendo (son parte de lo vendido) y aparte se listan en «anticipos».
CREATE OR REPLACE FUNCTION fn_resumen_apertura(p_apertura_id bigint) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE a aperturas_caja; hasta timestamptz; vids bigint[]; r jsonb; metodos jsonb; ingresos jsonb; egresos jsonb; monedas jsonb; anticipos jsonb; res record;
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

    -- Anticipos de encargo aplicados en las ventas de este turno (no entraron hoy a la gaveta: se muestran aparte).
    SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.moneda, x.metodo), '[]'::jsonb) INTO anticipos FROM (
        SELECT trim(pv.moneda) AS moneda, mp.nombre AS metodo, count(*) AS n, sum(pv.monto) AS monto, sum(pv.monto_usd) AS usd, sum(pv.monto_ves) AS ves
          FROM pagos_venta pv JOIN ventas t ON t.id = pv.venta_id AND t.id = ANY(vids) JOIN metodos_pago mp ON mp.id = pv.metodo_pago_id
         WHERE pv.es_anticipo GROUP BY mp.nombre, trim(pv.moneda)) x;

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
               -- el cambio del 24: los pagos con es_anticipo NO cuentan como efectivo recibido hoy
               COALESCE((SELECT sum(COALESCE(pv.monto_entregado, pv.monto_cobrado)) FROM pagos_venta pv JOIN ventas t ON t.id = pv.venta_id AND t.id = ANY(vids) JOIN metodos_pago mp ON mp.id = pv.metodo_pago_id
                          WHERE mp.es_efectivo AND trim(pv.moneda) = mo.moneda AND NOT pv.es_anticipo), 0) AS recibido,
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
        'metodos', metodos, 'anticipos', anticipos, 'ingresos', ingresos, 'egresos', egresos, 'monedas', monedas);
    RETURN r;
END $$;
COMMENT ON FUNCTION fn_resumen_apertura(bigint) IS 'Cifras del turno (Corte X/Z). Versión del archivo 24: los pagos con es_anticipo (anticipos de encargos aplicados al entregar) no cuentan como efectivo recibido hoy; se listan aparte en «anticipos».';
