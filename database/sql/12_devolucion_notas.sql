-- =============================================================================
--  12 · Devolución de mercancía con nota de crédito (OPCIONAL; requiere 10_contabilidad.sql)
-- =============================================================================
--  Hasta ahora una nota de crédito solo corregía la factura (Ventas / IVA / Caja). Este parche agrega la devolución física:
--    1. notas_ajuste.devuelve_inventario y la tabla notas_ajuste_detalle (qué producto y cuántas unidades vuelven).
--    2. Movimiento de kardex DEVOLUCION_CLIENTE (suma stock). El stock se mueve SIEMPRE, con o sin contabilidad automática.
--    3. sp_registrar_nota_ajuste recibe p_devuelve_inventario y p_productos (jsonb: [{"producto_id":1,"cantidad":2}, ...]).
--       No admite devolver más de lo vendido (descontando lo ya devuelto en otras notas de esa venta).
--    4. Asiento de costo por cada producto devuelto (solo con contab_config.automatica = true):
--         Debe  Inventario (1.1.03)  /  Haber  Costo de ventas (5.1.01)
--         = cantidad × costo_unitario_usd congelado en la venta original × tasa de esa venta.
--    5. Una venta con devolución física ya no se puede anular (anularla devolvería el stock por segunda vez).
--  Si el período de la nota está cerrado, la nota falla igual que antes (bloqueo de asientos del 11), antes de mover stock.
--     psql -d tienda -f 12_devolucion_notas.sql
-- =============================================================================
SET search_path = tienda, public;

-- 1. Columna y tabla de detalle ------------------------------------------------
ALTER TABLE notas_ajuste ADD COLUMN IF NOT EXISTS devuelve_inventario boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN notas_ajuste.devuelve_inventario IS 'TRUE si el cliente devolvió mercancía física: el detalle está en notas_ajuste_detalle y el stock ya subió.';

CREATE TABLE IF NOT EXISTS notas_ajuste_detalle (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nota_id      bigint        NOT NULL REFERENCES notas_ajuste(id),
    producto_id  bigint        NOT NULL REFERENCES productos(id),
    cantidad     numeric(14,3) NOT NULL CHECK (cantidad > 0),
    UNIQUE (nota_id, producto_id)
);
CREATE INDEX IF NOT EXISTS ix_nota_det_producto ON notas_ajuste_detalle (producto_id);
COMMENT ON TABLE notas_ajuste_detalle IS 'Productos y unidades que vuelven al inventario con una nota de crédito. Inmutable.';
DROP TRIGGER IF EXISTS trg_nota_det_inmutable ON notas_ajuste_detalle;
CREATE TRIGGER trg_nota_det_inmutable BEFORE UPDATE OR DELETE ON notas_ajuste_detalle FOR EACH ROW EXECUTE FUNCTION trg_bloquear_modificacion();

-- 2. Kardex: nuevo tipo que suma -----------------------------------------------
ALTER TABLE movimientos_inventario DROP CONSTRAINT IF EXISTS movimientos_inventario_tipo_check;
ALTER TABLE movimientos_inventario ADD CONSTRAINT movimientos_inventario_tipo_check CHECK (tipo IN
    ('COMPRA','VENTA','ANULACION_VENTA','ANULACION_COMPRA','AJUSTE_ENTRADA','AJUSTE_SALIDA','INVENTARIO_INICIAL','DEVOLUCION_CLIENTE'));
ALTER TABLE movimientos_inventario DROP CONSTRAINT IF EXISTS ck_mov_signo;
ALTER TABLE movimientos_inventario ADD CONSTRAINT ck_mov_signo CHECK (
    (tipo IN ('COMPRA','ANULACION_VENTA','AJUSTE_ENTRADA','INVENTARIO_INICIAL','DEVOLUCION_CLIENTE') AND cantidad > 0) OR
    (tipo IN ('VENTA','ANULACION_COMPRA','AJUSTE_SALIDA') AND cantidad < 0));

-- 3. Tipo de asiento del costo (las listas de 10 y 11 ya lo incluyen; esto cubre bases ya instaladas) ---------------
ALTER TABLE asientos DROP CONSTRAINT IF EXISTS asientos_origen_tipo_check;
ALTER TABLE asientos ADD CONSTRAINT asientos_origen_tipo_check CHECK (origen_tipo IN
    ('MANUAL','APERTURA','VENTA','ANULACION_VENTA','COMPRA','ANULACION_COMPRA','NOTA_CREDITO','NOTA_DEBITO','DEVOLUCION_COSTO','PAGO_PROVEEDOR','ANULACION_PAGO','CIERRE','AJUSTE_CAMBIARIO'));

-- 4. Qué se puede devolver de una venta ------------------------------------------
--    vendida = suma de las líneas de ese producto; devuelta = lo ya devuelto en notas anteriores; costo promedio ponderado congelado en la venta.
CREATE OR REPLACE FUNCTION fn_devolvibles_venta(p_venta_id bigint)
RETURNS TABLE (producto_id bigint, sku text, nombre text, vendida numeric, devuelta numeric, disponible numeric, costo_unitario_usd numeric, tasa_cambio numeric)
LANGUAGE sql STABLE AS $$
    SELECT d.producto_id, p.sku::text, p.nombre::text, d.vendida,
           COALESCE(x.devuelta, 0), d.vendida - COALESCE(x.devuelta, 0),
           d.costo, v.tasa_cambio
      FROM (SELECT producto_id, sum(cantidad) AS vendida,
                   COALESCE(sum(cantidad * COALESCE(costo_unitario_usd, 0)) / NULLIF(sum(cantidad), 0), 0) AS costo
              FROM detalle_venta WHERE venta_id = p_venta_id GROUP BY producto_id) d
      JOIN ventas v ON v.id = p_venta_id
      JOIN productos p ON p.id = d.producto_id
      LEFT JOIN (SELECT nd.producto_id, sum(nd.cantidad) AS devuelta
                   FROM notas_ajuste_detalle nd JOIN notas_ajuste n ON n.id = nd.nota_id WHERE n.venta_id = p_venta_id GROUP BY nd.producto_id) x
             ON x.producto_id = d.producto_id
     ORDER BY p.nombre, d.producto_id;
$$;

-- Costo en Bs de devolver p_cantidad: cantidad × costo congelado (USD) × tasa de la venta original.
CREATE OR REPLACE FUNCTION fn_costo_devolucion(p_venta_id bigint, p_producto_id bigint, p_cantidad numeric) RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT ROUND(ROUND(p_cantidad * f.costo_unitario_usd, 2) * f.tasa_cambio, 2) FROM fn_devolvibles_venta(p_venta_id) f WHERE f.producto_id = p_producto_id;
$$;

-- 5. Procedimiento: ahora acepta la devolución física -------------------------------
DROP PROCEDURE IF EXISTS sp_registrar_nota_ajuste(char, bigint, text, numeric, text, bigint, text, date);
CREATE OR REPLACE PROCEDURE sp_registrar_nota_ajuste(
    p_tipo char(1), p_venta_id bigint, p_numero text, p_base_ves numeric, p_motivo text, p_usuario_id bigint,
    p_numero_control text DEFAULT NULL, p_fecha date DEFAULT NULL,
    p_devuelve_inventario boolean DEFAULT false, p_productos jsonb DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE v ventas; iva numeric; v_nota_id bigint; r record; f record; v_devuelve boolean := COALESCE(p_devuelve_inventario, false);
BEGIN
    IF p_tipo NOT IN ('C','D') THEN RAISE EXCEPTION 'Tipo de nota inválido: use C (crédito) o D (débito)' USING ERRCODE = 'TV006'; END IF;
    IF p_base_ves IS NULL OR p_base_ves <= 0 THEN RAISE EXCEPTION 'La base de la nota debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF p_motivo IS NULL OR length(trim(p_motivo)) < 3 THEN RAISE EXCEPTION 'Indique el motivo de la nota' USING ERRCODE = 'TV006'; END IF;
    IF v_devuelve AND p_tipo <> 'C' THEN RAISE EXCEPTION 'Solo una nota de crédito puede devolver mercancía al inventario' USING ERRCODE = 'TV006'; END IF;
    IF v_devuelve AND (p_productos IS NULL OR jsonb_typeof(p_productos) <> 'array' OR jsonb_array_length(p_productos) = 0) THEN
        RAISE EXCEPTION 'Indique qué productos devuelve el cliente' USING ERRCODE = 'TV006';
    END IF;
    SELECT * INTO v FROM ventas WHERE id = p_venta_id FOR UPDATE;      -- serializa las notas de una misma venta: dos no devuelven lo mismo
    IF v.id IS NULL OR v.estado <> 'COMPLETADA' THEN RAISE EXCEPTION 'La venta % no existe o está anulada', p_venta_id USING ERRCODE = 'TV006'; END IF;
    iva := ROUND(p_base_ves * v.iva_pct / 100, 2);

    -- Valida ANTES de insertar nada.
    IF v_devuelve THEN
        FOR r IN SELECT x.producto_id, sum(x.cantidad) AS cantidad
                   FROM jsonb_to_recordset(p_productos) AS x(producto_id bigint, cantidad numeric) GROUP BY x.producto_id ORDER BY x.producto_id LOOP
            IF r.producto_id IS NULL OR r.cantidad IS NULL OR r.cantidad <= 0 THEN RAISE EXCEPTION 'Cada producto devuelto necesita una cantidad mayor que cero' USING ERRCODE = 'TV006'; END IF;
            SELECT * INTO f FROM fn_devolvibles_venta(p_venta_id) WHERE producto_id = r.producto_id;
            IF f.producto_id IS NULL THEN RAISE EXCEPTION 'El producto % no forma parte de la venta %', r.producto_id, v.numero USING ERRCODE = 'TV006'; END IF;
            IF r.cantidad > f.disponible THEN
                RAISE EXCEPTION 'No puedes devolver % unidades de "%" (%): se vendieron %, ya se devolvieron % y quedan % por devolver',
                    r.cantidad, f.nombre, f.sku, f.vendida, f.devuelta, f.disponible USING ERRCODE = 'TV006';
            END IF;
        END LOOP;
    END IF;

    INSERT INTO notas_ajuste (tipo, venta_id, numero, numero_control, fecha, iva_pct, base_ves, iva_ves, total_ves, motivo, usuario_id, devuelve_inventario)
    VALUES (p_tipo, p_venta_id, trim(p_numero), p_numero_control, COALESCE(p_fecha, fn_hoy()), v.iva_pct, p_base_ves, iva, p_base_ves + iva, trim(p_motivo), p_usuario_id, v_devuelve)
    RETURNING id INTO v_nota_id;                                         -- aquí el trigger del 10 genera el asiento fiscal (y falla si el período está cerrado)

    IF v_devuelve THEN
        PERFORM set_config('tienda.usuario_id', COALESCE(p_usuario_id::text, ''), true);
        FOR r IN SELECT x.producto_id, sum(x.cantidad) AS cantidad
                   FROM jsonb_to_recordset(p_productos) AS x(producto_id bigint, cantidad numeric) GROUP BY x.producto_id ORDER BY x.producto_id LOOP
            INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, referencia_tipo, referencia_id, motivo, usuario_id)
            VALUES (r.producto_id, 'DEVOLUCION_CLIENTE', r.cantidad, 'NOTA_CREDITO', v_nota_id, 'Devolución del cliente · ' || trim(p_numero) || ' · ' || trim(p_motivo), p_usuario_id);
            INSERT INTO notas_ajuste_detalle (nota_id, producto_id, cantidad) VALUES (v_nota_id, r.producto_id, r.cantidad);   -- dispara el asiento de costo
        END LOOP;
    END IF;
END $$;
COMMENT ON PROCEDURE sp_registrar_nota_ajuste(char, bigint, text, numeric, text, bigint, text, date, boolean, jsonb) IS
    'Registra una nota de crédito (C) o débito (D). Con p_devuelve_inventario (solo crédito) y p_productos [{"producto_id":..,"cantidad":..}] devuelve esa mercancía al stock (kardex DEVOLUCION_CLIENTE).';

-- 6. Asiento de costo por cada producto devuelto ---------------------------------
CREATE OR REPLACE FUNCTION trg_contab_nota_credito_costo() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n notas_ajuste; costo numeric; v_nombre text;
BEGIN
    IF NOT COALESCE((SELECT automatica FROM contab_config WHERE id = fn_negocio_actual()), false) THEN RETURN NULL; END IF;
    SELECT * INTO n FROM notas_ajuste WHERE id = NEW.nota_id;
    costo := fn_costo_devolucion(n.venta_id, NEW.producto_id, NEW.cantidad);
    IF COALESCE(costo, 0) <= 0 THEN RETURN NULL; END IF;                  -- producto sin costo congelado: no hay nada que reversar
    SELECT nombre INTO v_nombre FROM productos WHERE id = NEW.producto_id;
    PERFORM fn_crear_asiento(n.fecha, 'Costo de la devolución ' || n.numero || ': ' || NEW.cantidad::numeric(14,3)::text || ' × ' || v_nombre, 'DEVOLUCION_COSTO', NEW.id,
        jsonb_build_array(jsonb_build_object('cuenta_id', fn_cuenta_param('INVENTARIO'), 'debe', costo, 'glosa', 'Mercancía devuelta por el cliente'),
                          jsonb_build_object('cuenta_id', fn_cuenta_param('COSTO_VENTAS'), 'haber', costo, 'glosa', 'Reverso del costo de ventas')), n.usuario_id);
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contab_nota_credito_costo ON notas_ajuste_detalle;
CREATE TRIGGER trg_contab_nota_credito_costo AFTER INSERT ON notas_ajuste_detalle FOR EACH ROW EXECUTE FUNCTION trg_contab_nota_credito_costo();

-- 7. Una venta con devolución física no se anula (el stock volvería dos veces) ---------
CREATE OR REPLACE FUNCTION trg_bloquear_anular_con_devolucion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM notas_ajuste WHERE venta_id = OLD.id AND devuelve_inventario) THEN
        RAISE EXCEPTION 'La venta % ya tiene una devolución de mercancía por nota de crédito: anularla devolvería el stock por segunda vez. Emite notas de crédito por lo que falte.', OLD.numero USING ERRCODE = 'TV006';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_anular_con_devolucion ON ventas;
CREATE TRIGGER trg_anular_con_devolucion BEFORE UPDATE OF estado ON ventas
    FOR EACH ROW WHEN (OLD.estado = 'COMPLETADA' AND NEW.estado = 'ANULADA') EXECUTE FUNCTION trg_bloquear_anular_con_devolucion();
