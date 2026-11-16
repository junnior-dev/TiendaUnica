-- =============================================================================
--  26 · ÓRDENES DE COMPRA · recepción parcial (backorder) · sugerencia automática
-- =============================================================================
--  Requiere: 01..24 (usa fn_registrar_compra del 02 y v_stock_bajo del 04). Es idempotente:
--     psql -d tienda -v ON_ERROR_STOP=1 -f 26_ordenes_compra.sql
--
--  Qué resuelve: antes del 26 una «compra» era SIEMPRE una factura ya recibida. Pero en un repuesto
--  el proceso real es: pedir al proveedor → llegar la mitad → llegar el resto en otra factura.
--  El flujo nuevo NO reemplaza a las compras: las ordena.
--
--     BORRADOR → ENVIADA → PARCIAL → RECIBIDA
--                        → CERRADA (se cancela lo que faltó)
--                        → ANULADA (solo si no llegó nada)
--
--     · fn_crear_orden            la lista que pides (por presentaciones o por piezas, con fn_cantidad_en_unidades del 23).
--     · fn_enviar_orden           la marcas como pedida al proveedor (queda el backorder abierto).
--     · fn_recibir_orden          llega UNA factura del proveedor: registra la COMPRA REAL (factura fiscal,
--                                 costo, IVA, kardex, política de precios… exactamente igual que antes) y
--                                 abona las cantidades recibidas a la orden. Si falta, la orden queda PARCIAL.
--     · fn_cerrar_orden           cancela lo pendiente («no va a llegar más de esto»).
--     · fn_sugerir_compra         qué reponer: stock mínimo + consumo de los últimos 30 días.
--
--  La recepción parcial se hace factura por factura: si llegan 2 tandas con 2 facturas, se llaman dos veces.
-- =============================================================================
SET search_path = tienda, public;

CREATE SEQUENCE IF NOT EXISTS seq_orden_compra START 1;

CREATE TABLE IF NOT EXISTS ordenes_compra (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    numero         bigint NOT NULL DEFAULT nextval('seq_orden_compra') UNIQUE,
    proveedor_id   bigint   NOT NULL REFERENCES proveedores(id),
    fecha          date     NOT NULL DEFAULT fn_hoy(),
    estado         varchar(8) NOT NULL DEFAULT 'BORRADOR'
                   CHECK (estado IN ('BORRADOR','ENVIADA','PARCIAL','RECIBIDA','CERRADA','ANULADA')),
    observaciones  text,
    usuario_id     bigint   NOT NULL REFERENCES usuarios(id),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    fecha_envio    date,
    cerrada_en     date, cerrada_motivo text,
    anulada_en     timestamptz, anulada_motivo text,
    CONSTRAINT ck_orden_estado_fechas CHECK (
        (fecha_envio IS NULL OR estado IN ('ENVIADA','PARCIAL','RECIBIDA','CERRADA')) AND
        (cerrada_en  IS NULL OR estado = 'CERRADA') AND
        (anulada_en  IS NULL OR estado = 'ANULADA') AND
        (estado <> 'CERRADA' OR cerrada_motivo IS NOT NULL) AND
        (estado <> 'ANULADA' OR anulada_motivo IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_ordenes_estado ON ordenes_compra (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_ordenes_proveedor ON ordenes_compra (proveedor_id);
COMMENT ON TABLE  ordenes_compra IS 'Pedido al proveedor ANTES de la factura: qué se pidió, cuánto ha llegado y qué sigue pendiente (backorder). La factura real se registra en compras.';
COMMENT ON COLUMN ordenes_compra.numero IS 'Número de la orden (OC-1, OC-2…): es el mismo id.';

CREATE TABLE IF NOT EXISTS orden_compra_detalle (
    orden_id             bigint        NOT NULL REFERENCES ordenes_compra(id),
    producto_id          bigint        NOT NULL REFERENCES productos(id),
    cantidad_pedida      numeric(14,3) NOT NULL CHECK (cantidad_pedida > 0),
    cantidad_recibida    numeric(14,3) NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0),
    costo_estimado_usd   numeric(18,4),
    costo_unitario_usd   numeric(18,4),          -- último costo recibido (congelado, para comparar)
    ultima_compra_id     bigint,                  -- última compra (factura) que abonó esta línea
    PRIMARY KEY (orden_id, producto_id),
    CHECK (cantidad_recibida <= cantidad_pedida)
);
CREATE INDEX IF NOT EXISTS ix_orden_det_prod ON orden_compra_detalle (producto_id);
COMMENT ON TABLE  orden_compra_detalle IS 'Líneas de la orden: pedido, recibido y pendiente (backorder) por producto. Las cantidades son PIEZAS (unidades de venta).';
COMMENT ON COLUMN orden_compra_detalle.costo_estimado_usd IS 'Costo estimado por pieza al pedir (USD). El real entra con la factura de compra.';

-- Guardia: una orden se anula o se cierra, nunca se borra; su cabecera no se edita más allá del estado.
CREATE OR REPLACE FUNCTION trg_ordenes_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o jsonb; n jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Una orden de compra no se borra: anúlala' USING ERRCODE = 'TV005'; END IF;
    o := to_jsonb(OLD) - 'estado' - 'fecha_envio' - 'cerrada_en' - 'cerrada_motivo' - 'anulada_en' - 'anulada_motivo' - 'observaciones' - 'updated_at';
    n := to_jsonb(NEW) - 'estado' - 'fecha_envio' - 'cerrada_en' - 'cerrada_motivo' - 'anulada_en' - 'anulada_motivo' - 'observaciones' - 'updated_at';
    IF o <> n THEN RAISE EXCEPTION 'La orden de compra no se edita después de crearla' USING ERRCODE = 'TV005'; END IF;
    IF OLD.estado IN ('CERRADA','ANULADA') THEN RAISE EXCEPTION 'La orden ya está % y no cambia', OLD.estado USING ERRCODE = 'TV005'; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ordenes_guardia ON ordenes_compra;
CREATE TRIGGER trg_ordenes_guardia BEFORE UPDATE OR DELETE ON ordenes_compra FOR EACH ROW EXECUTE FUNCTION trg_ordenes_guardia();
DROP TRIGGER IF EXISTS trg_ordenes_updated ON ordenes_compra;
CREATE TRIGGER trg_ordenes_updated BEFORE UPDATE ON ordenes_compra FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Línea: mientras no haya llegado nada se puede corregir la cantidad pedida o el costo estimado (BORRADOR/ENVIADA).
CREATE OR REPLACE FUNCTION trg_orden_detalle_guardia() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e ordenes_compra;
BEGIN
    IF TG_OP = 'DELETE' THEN
        SELECT * INTO e FROM ordenes_compra WHERE id = OLD.orden_id;
        IF e.estado <> 'BORRADOR' OR OLD.cantidad_recibida > 0 THEN
            RAISE EXCEPTION 'Una línea de orden solo se quita en una orden BORRADOR y sin recepciones' USING ERRCODE = 'TV005'; END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND COALESCE(current_setting('tienda.recibiendo_orden', true), '') = '1' THEN
        -- Recepción (fn_recibir_orden): lo recibido solo sube, sin importar el estado de la orden.
        IF NEW.cantidad_recibida < OLD.cantidad_recibida THEN
            RAISE EXCEPTION 'Las cantidades recibidas solo suben (nunca se reduce lo recibido)' USING ERRCODE = 'TV005'; END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO e FROM ordenes_compra WHERE id = NEW.orden_id;
    IF e.id IS NULL THEN RAISE EXCEPTION 'La orden no existe' USING ERRCODE = 'TV006'; END IF;
    IF e.estado NOT IN ('BORRADOR','ENVIADA') THEN
        RAISE EXCEPTION 'La orden está %: sus líneas ya no se editan a mano', e.estado USING ERRCODE = 'TV005'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.cantidad_recibida IS DISTINCT FROM OLD.cantidad_recibida OR NEW.costo_unitario_usd IS DISTINCT FROM OLD.costo_unitario_usd
           OR NEW.ultima_compra_id IS DISTINCT FROM OLD.ultima_compra_id THEN
            RAISE EXCEPTION 'Las cantidades recibidas solo las actualiza fn_recibir_orden' USING ERRCODE = 'TV005'; END IF;
        IF NEW.cantidad_pedida < OLD.cantidad_recibida THEN
            RAISE EXCEPTION 'La cantidad pedida (%) no puede bajar de lo ya recibido (%)', NEW.cantidad_pedida, OLD.cantidad_recibida USING ERRCODE = 'TV006'; END IF;
        RETURN NEW;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_orden_detalle_guardia ON orden_compra_detalle;
CREATE TRIGGER trg_orden_detalle_guardia BEFORE INSERT OR UPDATE OR DELETE ON orden_compra_detalle
    FOR EACH ROW EXECUTE FUNCTION trg_orden_detalle_guardia();

-- ---------------------------------------------------------------------------
--  1. CREAR / ENVIAR / CERRAR / ANULAR
-- ---------------------------------------------------------------------------
-- p_items: [{"producto_id":1,"cantidad":2,"costo_estimado_usd":4.5}] — cantidad EN PIEZAS.
-- La pantalla de compras convierte presentaciones → piezas con fn_cantidad_en_unidades.
CREATE OR REPLACE FUNCTION fn_crear_orden(p_proveedor_id bigint, p_items jsonb, p_usuario_id bigint, p_observaciones text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint; it record; n int := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM proveedores WHERE id = p_proveedor_id AND activo) THEN
        RAISE EXCEPTION 'El proveedor no existe o está inactivo' USING ERRCODE = 'TV006'; END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'La orden debe tener al menos un producto' USING ERRCODE = 'TV006'; END IF;
    INSERT INTO ordenes_compra (proveedor_id, observaciones, usuario_id)
    VALUES (p_proveedor_id, NULLIF(trim(p_observaciones), ''), p_usuario_id) RETURNING id INTO v_id;
    FOR it IN SELECT * FROM jsonb_to_recordset(p_items) AS x(producto_id bigint, cantidad numeric, costo_estimado_usd numeric) LOOP
        IF it.cantidad IS NULL OR it.cantidad <= 0 THEN
            RAISE EXCEPTION 'Cada línea de la orden necesita una cantidad mayor que cero' USING ERRCODE = 'TV006'; END IF;
        IF NOT EXISTS (SELECT 1 FROM productos WHERE id = it.producto_id) THEN
            RAISE EXCEPTION 'El producto % no existe', it.producto_id USING ERRCODE = 'TV006'; END IF;
        INSERT INTO orden_compra_detalle (orden_id, producto_id, cantidad_pedida, costo_estimado_usd)
        VALUES (v_id, it.producto_id, ROUND(it.cantidad, 3), it.costo_estimado_usd)
        ON CONFLICT (orden_id, producto_id) DO UPDATE SET cantidad_pedida = orden_compra_detalle.cantidad_pedida + EXCLUDED.cantidad_pedida;
        n := n + 1;
    END LOOP;
    RETURN v_id;
END $$;
COMMENT ON FUNCTION fn_crear_orden(bigint, jsonb, bigint, text) IS 'Crea una orden de compra en BORRADOR. Cantidades en piezas (unidades de venta).';

-- Añadir o corregir líneas de una orden BORRADOR (antes de pedirla).
CREATE OR REPLACE FUNCTION fn_editar_linea_orden(p_orden_id bigint, p_producto_id bigint, p_cantidad numeric, p_costo_estimado_usd numeric DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE e ordenes_compra;
BEGIN
    SELECT * INTO e FROM ordenes_compra WHERE id = p_orden_id;
    IF e.id IS NULL THEN RAISE EXCEPTION 'La orden no existe' USING ERRCODE = 'TV006'; END IF;
    IF e.estado <> 'BORRADOR' THEN RAISE EXCEPTION 'Solo se editan las líneas de una orden BORRADOR' USING ERRCODE = 'TV005'; END IF;
    IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
        DELETE FROM orden_compra_detalle WHERE orden_id = p_orden_id AND producto_id = p_producto_id;
        RETURN;
    END IF;
    INSERT INTO orden_compra_detalle (orden_id, producto_id, cantidad_pedida, costo_estimado_usd)
    VALUES (p_orden_id, p_producto_id, ROUND(p_cantidad, 3), p_costo_estimado_usd)
    ON CONFLICT (orden_id, producto_id)
    DO UPDATE SET cantidad_pedida = EXCLUDED.cantidad_pedida, costo_estimado_usd = EXCLUDED.costo_estimado_usd;
END $$;
COMMENT ON FUNCTION fn_editar_linea_orden(bigint, bigint, numeric, numeric) IS 'Cambia la cantidad pedida de una línea (o la quita con cantidad <= 0). Solo en BORRADOR.';

-- BORRADOR → ENVIADA. p_nota se guarda en observaciones (ej. «por WhatsApp al proveedor»).
CREATE OR REPLACE FUNCTION fn_enviar_orden(p_orden_id bigint, p_usuario_id bigint, p_nota text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE e ordenes_compra;
BEGIN
    SELECT * INTO e FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
    IF e.id IS NULL THEN RAISE EXCEPTION 'La orden no existe' USING ERRCODE = 'TV006'; END IF;
    IF e.estado <> 'BORRADOR' THEN RAISE EXCEPTION 'Solo se envía una orden BORRADOR (esta está %)', e.estado USING ERRCODE = 'TV005'; END IF;
    IF NOT EXISTS (SELECT 1 FROM orden_compra_detalle WHERE orden_id = p_orden_id) THEN
        RAISE EXCEPTION 'La orden no tiene productos: agrégale las líneas antes de enviarla' USING ERRCODE = 'TV006'; END IF;
    UPDATE ordenes_compra SET estado = 'ENVIADA', fecha_envio = fn_hoy(),
           observaciones = COALESCE(NULLIF(trim(p_nota), ''), observaciones)
     WHERE id = p_orden_id;
END $$;
COMMENT ON FUNCTION fn_enviar_orden(bigint, bigint, text) IS 'Marca la orden como pedida al proveedor (ENVIADA). El backorder queda abierto.';

-- Cierra el backorder: lo que falta NO va a llegar. Solo si no todo llegó.
CREATE OR REPLACE FUNCTION fn_cerrar_orden(p_orden_id bigint, p_usuario_id bigint, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE e ordenes_compra; pend numeric;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Indica por qué se cierra la orden (ej. «el proveedor no tiene más»)' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO e FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
    IF e.id IS NULL THEN RAISE EXCEPTION 'La orden no existe' USING ERRCODE = 'TV006'; END IF;
    IF e.estado NOT IN ('ENVIADA','PARCIAL') THEN RAISE EXCEPTION 'Solo se cierra una orden ENVIADA o PARCIAL (esta está %)', e.estado USING ERRCODE = 'TV005'; END IF;
    SELECT COALESCE(sum(cantidad_pedida - cantidad_recibida), 0) INTO pend FROM orden_compra_detalle WHERE orden_id = p_orden_id;
    IF pend <= 0 THEN RAISE EXCEPTION 'La orden ya está completa: usa el estado RECIBIDA' USING ERRCODE = 'TV006'; END IF;
    UPDATE ordenes_compra SET estado = 'CERRADA', cerrada_en = fn_hoy(), cerrada_motivo = trim(p_motivo) WHERE id = p_orden_id;
END $$;
COMMENT ON FUNCTION fn_cerrar_orden(bigint, bigint, text) IS 'Cierra el backorder de una orden: lo pendiente se da por cancelado con su motivo.';

-- Anula una orden que no recibió nada.
CREATE OR REPLACE FUNCTION fn_anular_orden(p_orden_id bigint, p_usuario_id bigint, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE e ordenes_compra; rec numeric;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Indica el motivo de la anulación' USING ERRCODE = 'TV006'; END IF;
    SELECT * INTO e FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
    IF e.id IS NULL THEN RAISE EXCEPTION 'La orden no existe' USING ERRCODE = 'TV006'; END IF;
    SELECT COALESCE(sum(cantidad_recibida), 0) INTO rec FROM orden_compra_detalle WHERE orden_id = p_orden_id;
    IF rec > 0 THEN
        RAISE EXCEPTION 'La orden ya tiene recepciones (% piezas): no se anula; cancela lo pendiente con fn_cerrar_orden', rec USING ERRCODE = 'TV005';
    END IF;
    UPDATE ordenes_compra SET estado = 'ANULADA', anulada_en = now(), anulada_motivo = trim(p_motivo) WHERE id = p_orden_id;
END $$;
COMMENT ON FUNCTION fn_anular_orden(bigint, bigint, text) IS 'Anula una orden sin recepciones.';

-- ---------------------------------------------------------------------------
--  2. RECEPCIÓN (parcial o total): registra la COMPRA REAL y abona la orden
-- ---------------------------------------------------------------------------
--  p_items: [{"producto_id":1,"cantidad":24,"costo_unitario":2.35,"exento":false}]
--    · cantidad en PIEZAS de venta (la pantalla convierte cajas con fn_cantidad_en_unidades).
--    · costo_unitario en la MONEDA DE LA FACTURA (igual que Compras; sin IVA).
--    · No puede recibir más de lo pendiente de la línea (TV006): el proveedor no manda de más.
--  El resto de la factura (condición, crédito fiscal, días) es igual que en Compras.
CREATE OR REPLACE FUNCTION fn_recibir_orden(
    p_orden_id bigint, p_items jsonb, p_numero_factura text, p_fecha_factura date, p_moneda char(3),
    p_usuario_id bigint, p_numero_control text DEFAULT NULL, p_condicion text DEFAULT 'CONTADO',
    p_dias_credito int DEFAULT 0, p_aplica_credito_fiscal boolean DEFAULT NULL, p_observaciones text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE e ordenes_compra; d orden_compra_detalle; it record; pend numeric; compra_id bigint;
        obs text; cond text; falta numeric;
BEGIN
    SELECT * INTO e FROM ordenes_compra WHERE id = p_orden_id FOR UPDATE;
    IF e.id IS NULL THEN RAISE EXCEPTION 'La orden no existe' USING ERRCODE = 'TV006'; END IF;
    IF e.estado NOT IN ('ENVIADA','PARCIAL') THEN
        RAISE EXCEPTION 'Solo se recibe una orden ENVIADA o PARCIAL (esta está %)', e.estado USING ERRCODE = 'TV005'; END IF;
    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Indica las líneas que están llegando' USING ERRCODE = 'TV006'; END IF;
    IF p_numero_factura IS NULL OR length(trim(p_numero_factura)) = 0 THEN
        RAISE EXCEPTION 'Indica el número de la factura del proveedor' USING ERRCODE = 'TV006'; END IF;
    IF p_fecha_factura IS NULL OR p_fecha_factura > fn_hoy() THEN
        RAISE EXCEPTION 'La fecha de la factura no puede ser futura' USING ERRCODE = 'TV006'; END IF;

    -- a) validar antes de tocar: cada cantidad cabe en su backorder y cada producto pertenece a la orden
    FOR it IN SELECT * FROM jsonb_to_recordset(p_items) AS x(producto_id bigint, cantidad numeric, costo_unitario numeric, exento boolean) LOOP
        SELECT * INTO d FROM orden_compra_detalle WHERE orden_id = p_orden_id AND producto_id = it.producto_id;
        IF d.producto_id IS NULL THEN
            RAISE EXCEPTION 'El producto % no está en la orden: no recibas de más por esta vía (agrégalo primero a la orden o registra la compra suelta)', it.producto_id USING ERRCODE = 'TV006'; END IF;
        IF it.cantidad IS NULL OR it.cantidad <= 0 THEN
            RAISE EXCEPTION 'La cantidad recibida del producto % debe ser mayor que cero', it.producto_id USING ERRCODE = 'TV006'; END IF;
        pend := d.cantidad_pedida - d.cantidad_recibida;
        IF it.cantidad > pend + 0.0001 THEN
            RAISE EXCEPTION 'La línea de la orden tiene pendiente % piezas del producto % y llegaron %: recibe % o aumenta la cantidad pedida',
                pend, it.producto_id, it.cantidad, pend USING ERRCODE = 'TV006'; END IF;
    END LOOP;

    -- b) la factura REAL (fiscal): todo el peso recae en fn_registrar_compra + sus triggers del 02/03
    obs := NULLIF(trim('Orden de compra ' || e.numero
        || (CASE WHEN COALESCE(p_observaciones, '') <> '' THEN ' · ' || trim(p_observaciones) ELSE '' END)), '');
    cond := upper(COALESCE(p_condicion, 'CONTADO'));
    IF cond NOT IN ('CONTADO','CREDITO') THEN RAISE EXCEPTION 'La condición debe ser CONTADO o CREDITO' USING ERRCODE = 'TV006'; END IF;
    compra_id := fn_registrar_compra(e.proveedor_id, trim(p_numero_factura), p_fecha_factura, p_moneda,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'producto_id', x.producto_id, 'cantidad', x.cantidad, 'costo_unitario', x.costo_unitario, 'exento', x.exento) ORDER BY x.producto_id), '[]'::jsonb)
           FROM jsonb_to_recordset(p_items) AS x(producto_id bigint, cantidad numeric, costo_unitario numeric, exento boolean)),
        p_usuario_id, p_numero_control, p_aplica_credito_fiscal, obs);
    IF cond = 'CREDITO' AND to_regclass('pagos_proveedor') IS NOT NULL THEN
        PERFORM fn_compra_a_credito(compra_id, COALESCE(p_dias_credito, 0));
    END IF;

    -- c) abonar las cantidades recibidas a la orden (piezas) y congelar el costo de la última recepción
    PERFORM set_config('tienda.recibiendo_orden', '1', true);
    FOR it IN SELECT * FROM jsonb_to_recordset(p_items) AS x(producto_id bigint, cantidad numeric, costo_unitario numeric) LOOP
        UPDATE orden_compra_detalle od
           SET cantidad_recibida = od.cantidad_recibida + ROUND(it.cantidad, 3),
               costo_unitario_usd = ROUND(it.costo_unitario / CASE WHEN p_moneda = 'USD' THEN 1 ELSE fn_tasa_bcv(p_fecha_factura) END, 4),
               ultima_compra_id = compra_id
         WHERE od.orden_id = p_orden_id AND od.producto_id = it.producto_id;
    END LOOP;
    PERFORM set_config('tienda.recibiendo_orden', '', true);

    SELECT COALESCE(sum(cantidad_pedida - cantidad_recibida), 0) INTO falta FROM orden_compra_detalle WHERE orden_id = p_orden_id;
    UPDATE ordenes_compra SET estado = CASE WHEN falta <= 0.0001 THEN 'RECIBIDA' ELSE 'PARCIAL' END WHERE id = p_orden_id;
    RETURN compra_id;
END $$;
COMMENT ON FUNCTION fn_recibir_orden(bigint, jsonb, text, date, char, bigint, text, text, int, boolean, text) IS 'Recepción de una orden: registra la factura REAL en compras (IVA, costo, kardex, precios) y abona las cantidades a la orden. Falta mercancía → PARCIAL; completa → RECIBIDA.';

-- ---------------------------------------------------------------------------
--  3. SUGERENCIA AUTOMÁTICA DE COMPRA
-- ---------------------------------------------------------------------------
--  Qué conviene reponer AHORA: lo que falta para el stock mínimo… o para aguantar el consumo
--  de los próximos p_dias (por defecto 15), tomado de las ventas de los últimos p_dias_venta (30).
--     sugerido = GREATEST(stock_minimo − stock, ceil(consumo_diario × p_dias) − stock)  y nunca < 0.
--  Productos con rotación pero sin stock mínimo definido también entran (stock_minimo = 0).
CREATE OR REPLACE FUNCTION fn_sugerir_compra(p_dias_cobertura int DEFAULT 15, p_dias_venta int DEFAULT 30)
RETURNS TABLE (producto_id bigint, sku varchar, nombre varchar, categoria varchar, unidad varchar,
               unidad_compra varchar, piezas_por_presentacion numeric, stock_actual numeric, stock_minimo numeric,
               consumo_30d numeric, consumo_diario numeric, dias_para_agotar numeric, faltante_minimo numeric,
               sugerido numeric, ultima_compra numeric, ultimo_costo_usd numeric, ultimo_proveedor varchar)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    WITH ventas_prod AS (
        SELECT d.producto_id, sum(d.cantidad) AS vendido
          FROM detalle_venta d JOIN ventas v ON v.id = d.venta_id
         WHERE v.estado = 'COMPLETADA' AND v.fecha_valor >= fn_hoy() - COALESCE(p_dias_venta, 30)
         GROUP BY d.producto_id)
    SELECT p.id, p.sku, p.nombre, c.nombre, p.unidad, p.unidad_compra, p.piezas_por_presentacion,
           p.stock_actual, p.stock_minimo,
           COALESCE(vp.vendido, 0), COALESCE(vp.vendido, 0) / GREATEST(COALESCE(p_dias_venta, 30), 1),
           CASE WHEN COALESCE(vp.vendido, 0) > 0 THEN p.stock_actual / (vp.vendido / GREATEST(COALESCE(p_dias_venta, 30), 1)) ELSE NULL END,
           GREATEST(p.stock_minimo - p.stock_actual, 0),
           GREATEST(p.stock_minimo - p.stock_actual,
                    ceil(COALESCE(vp.vendido, 0) / GREATEST(COALESCE(p_dias_venta, 30), 1) * COALESCE(p_dias_cobertura, 15)) - p.stock_actual, 0),
           h.costo_usd, h.costo, pr.razon_social
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      LEFT JOIN ventas_prod vp ON vp.producto_id = p.id
      LEFT JOIN LATERAL (SELECT x.costo_inventario_unit_usd AS costo_usd, x.costo_unitario AS costo, cmp.proveedor_id
                           FROM compra_detalle x
                           JOIN (SELECT x2.producto_id AS pid, max(x2.compra_id) AS compra_id FROM compra_detalle x2 GROUP BY x2.producto_id) um
                             ON um.compra_id = x.compra_id AND um.pid = x.producto_id
                           JOIN compras cmp ON cmp.id = x.compra_id
                          WHERE x.producto_id = p.id LIMIT 1) h ON TRUE
      LEFT JOIN proveedores pr ON pr.id = h.proveedor_id
     WHERE p.activo
       AND (p.stock_actual <= p.stock_minimo OR COALESCE(vp.vendido, 0) > 0)
       AND GREATEST(p.stock_minimo - p.stock_actual,
                    ceil(COALESCE(vp.vendido, 0) / GREATEST(COALESCE(p_dias_venta, 30), 1) * COALESCE(p_dias_cobertura, 15)) - p.stock_actual, 0) > 0
     ORDER BY GREATEST(p.stock_minimo - p.stock_actual,
                    ceil(COALESCE(vp.vendido, 0) / GREATEST(COALESCE(p_dias_venta, 30), 1) * COALESCE(p_dias_cobertura, 15)) - p.stock_actual, 0) DESC, p.nombre;
END $$;
COMMENT ON FUNCTION fn_sugerir_compra(int, int) IS 'Sugerencia de reposición: faltante para el mínimo y para cubrir p_dias_cobertura de venta con el consumo de los últimos p_dias_venta días, con el último costo y proveedor de cada pieza.';

-- ---------------------------------------------------------------------------
--  4. CONSULTAS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ordenes_compra AS
SELECT o.id, o.numero, o.proveedor_id, pr.razon_social AS proveedor, pr.rif, o.fecha, o.estado, o.observaciones,
       o.fecha_envio, o.cerrada_en, o.cerrada_motivo, o.anulada_en, o.anulada_motivo, u.nombre_completo AS por,
       count(d.producto_id) AS n_lineas,
       COALESCE(sum(d.cantidad_pedida), 0) AS pedido_piezas,
       COALESCE(sum(d.cantidad_recibida), 0) AS recibido_piezas,
       COALESCE(sum(d.cantidad_pedida - d.cantidad_recibida), 0) AS pendiente_piezas,
       COALESCE(sum(d.cantidad_pedida * COALESCE(d.costo_estimado_usd, 0)), 0) AS estimado_usd,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('producto_id', p2.id, 'sku', p2.sku, 'nombre', p2.nombre, 'unidad', p2.unidad,
                          'unidad_compra', p2.unidad_compra, 'presentacion', p2.piezas_por_presentacion,
                          'pedida', d2.cantidad_pedida, 'recibida', d2.cantidad_recibida,
                          'pendiente', d2.cantidad_pedida - d2.cantidad_recibida,
                          'costo_estimado_usd', d2.costo_estimado_usd, 'costo_recibido_usd', d2.costo_unitario_usd)
                     ORDER BY p2.nombre)
          FROM orden_compra_detalle d2 JOIN productos p2 ON p2.id = d2.producto_id WHERE d2.orden_id = o.id), '[]'::jsonb) AS lineas
  FROM ordenes_compra o
  JOIN proveedores pr ON pr.id = o.proveedor_id
  JOIN usuarios u ON u.id = o.usuario_id
  LEFT JOIN orden_compra_detalle d ON d.orden_id = o.id
 GROUP BY o.id, pr.id, u.id;
COMMENT ON VIEW v_ordenes_compra IS 'Órdenes de compra con su backorder: pedido, recibido y pendiente por línea (JSON «lineas») y en totales.';

CREATE OR REPLACE VIEW v_ordenes_pendientes AS
SELECT * FROM v_ordenes_compra WHERE estado IN ('ENVIADA','PARCIAL') ORDER BY fecha_envio, id;
COMMENT ON VIEW v_ordenes_pendientes IS 'Órdenes con mercancía pendiente por recibir (backorder abierto).';
