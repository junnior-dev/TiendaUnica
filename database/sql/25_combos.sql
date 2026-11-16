-- =============================================================================
--  25 · COMBOS / KITS DE MANTENIMIENTO (aceite + filtro + bujías, etc.)
-- =============================================================================
--  Requiere: 01..24. Es idempotente:
--     psql -d tienda -v ON_ERROR_STOP=1 -f 25_combos.sql
--
--  Qué resuelve: el cliente pide «el kit de cambio de aceite de mi moto». En vez de buscar pieza por
--  pieza, la caja agrega EL COMBO y la venta sale con sus componentes reales:
--
--     · El combo NO es un producto: es una receta. La venta se registra con las líneas de cada
--       componente (sku, precio e IVA de cada pieza): el libro de ventas, el kardex y el costo de
--       cada línea quedan exactamente como si se hubiera vendido por separado.
--     · El descuento para llegar al precio del combo se reparte PROPORCIONALMENTE entre las líneas
--       (fn_combo_items): el descuento por línea respeta el máximo de 100 % y el total siempre
--       coincide con el precio del combo.
--     · Si el precio del combo no está definido (NULL), vale la suma de sus componentes sin descuento.
--     · Si el combo valdría MÁS que la suma de sus piezas, se rechaza (TV006): mejor un precio mal
--       puesto que una caja que descuadra.
--
--  Uso desde la app (Laravel), dentro de UNA transacción:
--     SELECT tienda.fn_registrar_venta_combo(:usuario, :combo_id, :cantidad, :pagos::jsonb, :cliente);
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  1. TABLAS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS combos (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku         varchar(40) NOT NULL,
    nombre      varchar(200) NOT NULL,
    descripcion text,
    precio_usd  numeric(18,4),              -- NULL = suma de los componentes (sin descuento)
    activo      boolean NOT NULL DEFAULT TRUE,
    usuario_id  bigint REFERENCES usuarios(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_combos_sku ON combos (upper(sku));
COMMENT ON TABLE  combos IS 'Kit de mantenimiento: receta de productos que se venden juntos a un precio único. La venta expande sus componentes.';
COMMENT ON COLUMN combos.precio_usd IS 'Precio del kit completo. NULL = vale la suma de sus componentes. No puede ser mayor que esa suma (se valida al vender).';
COMMENT ON COLUMN combos.sku IS 'Código corto del combo (KIT-ACE-125). No coincide con SKUs de productos: no comparten tabla.';

CREATE TABLE IF NOT EXISTS combo_componentes (
    combo_id    bigint        NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
    producto_id bigint        NOT NULL REFERENCES productos(id),
    cantidad    numeric(14,3) NOT NULL CHECK (cantidad > 0),
    PRIMARY KEY (combo_id, producto_id)
);
COMMENT ON TABLE combo_componentes IS 'Receta del combo: cada pieza y cuántas lleva. El stock y el IVA salen de cada producto al vender.';

CREATE OR REPLACE FUNCTION trg_combos_antes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        NEW.sku := upper(trim(NEW.sku));
        IF NEW.nombre IS NULL OR length(trim(NEW.nombre)) < 3 THEN
            RAISE EXCEPTION 'El combo necesita un nombre (ej. «Kit cambio de aceite CG 125»)' USING ERRCODE = 'TV006'; END IF;
        IF NEW.precio_usd IS NOT NULL AND NEW.precio_usd < 0 THEN
            RAISE EXCEPTION 'El precio del combo no puede ser negativo' USING ERRCODE = 'TV006'; END IF;
        NEW.updated_at := now();
        RETURN NEW;
    END IF;
    RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_combos_antes ON combos;
CREATE TRIGGER trg_combos_antes BEFORE INSERT OR UPDATE ON combos FOR EACH ROW EXECUTE FUNCTION trg_combos_antes();

CREATE OR REPLACE FUNCTION trg_combo_componentes_antes() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p productos;
BEGIN
    SELECT * INTO p FROM productos WHERE id = NEW.producto_id;
    IF p.id IS NULL THEN RAISE EXCEPTION 'El producto % no existe', NEW.producto_id USING ERRCODE = 'TV006'; END IF;
    IF NOT p.activo THEN RAISE EXCEPTION 'El producto "%" está inactivo: no puede formar parte de un combo', p.nombre USING ERRCODE = 'TV006'; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_combo_componentes_antes ON combo_componentes;
CREATE TRIGGER trg_combo_componentes_antes BEFORE INSERT OR UPDATE ON combo_componentes
    FOR EACH ROW EXECUTE FUNCTION trg_combo_componentes_antes();

-- ---------------------------------------------------------------------------
--  2. RECETA: items jsonb con el descuento repartido (una sola fórmula)
-- ---------------------------------------------------------------------------
-- Devuelve el «items» listo para fn_registrar_venta (producto, cantidad y descuento_pct por línea).
--   precio NULL            → descuento 0 en cada línea (vale la suma de piezas).
--   precio < suma de piezas → descuento proporcional para que el total dé el precio del combo.
--   precio > suma de piezas → error TV006 (el combo no puede valer más que sus piezas sueltas).
CREATE OR REPLACE FUNCTION fn_combo_items(p_combo_id bigint, p_cantidad numeric DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE c combos; suma numeric := 0; f numeric := 0; it record; items jsonb := '[]'::jsonb; descto numeric;
BEGIN
    SELECT * INTO c FROM combos WHERE id = p_combo_id AND activo;
    IF c.id IS NULL THEN RAISE EXCEPTION 'El combo % no existe o está inactivo', p_combo_id USING ERRCODE = 'TV006'; END IF;
    IF COALESCE(p_cantidad, 1) <= 0 THEN RAISE EXCEPTION 'La cantidad del combo debe ser mayor que cero' USING ERRCODE = 'TV006'; END IF;
    IF NOT EXISTS (SELECT 1 FROM combo_componentes WHERE combo_id = p_combo_id) THEN
        RAISE EXCEPTION 'El combo "%" no tiene piezas: agrégale sus componentes', c.nombre USING ERRCODE = 'TV006'; END IF;

    SELECT COALESCE(sum(p.precio_venta_usd * x.cantidad), 0) INTO suma
      FROM combo_componentes x JOIN productos p ON p.id = x.producto_id
     WHERE x.combo_id = p_combo_id;
    IF suma <= 0 THEN
        RAISE EXCEPTION 'Las piezas del combo "%" no tienen precio de venta: corrige los precios antes de venderlo', c.nombre USING ERRCODE = 'TV006';
    END IF;
    IF c.precio_usd IS NOT NULL THEN
        IF c.precio_usd > suma + 0.01 THEN
            RAISE EXCEPTION 'El combo "%" vale USD %, más que sus piezas sueltas (USD %). Baja el precio del combo o sube el de las piezas.',
                c.nombre, c.precio_usd, ROUND(suma, 2) USING ERRCODE = 'TV006';
        END IF;
        f := 1 - c.precio_usd / suma;                     -- fracción de descuento del kit
    END IF;

    FOR it IN SELECT x.cantidad, p.id, p.precio_venta_usd, (p.exento_iva OR p.exonerado_iva) AS sin_iva
                FROM combo_componentes x JOIN productos p ON p.id = x.producto_id
               WHERE x.combo_id = p_combo_id ORDER BY p.id LOOP
        descto := ROUND(f * 100, 2);
        IF descto < 0 THEN descto := 0; END IF;
        IF descto > 99.9 AND NOT it.sin_iva THEN descto := 99.9; END IF;   -- nunca una línea a 100 % (base 0): mejor repartir el resto
        items := items || jsonb_build_object('producto_id', it.id, 'cantidad', ROUND(it.cantidad * COALESCE(p_cantidad, 1), 3), 'descuento_pct', descto);
    END LOOP;
    RETURN items;
END $$;
COMMENT ON FUNCTION fn_combo_items(bigint, numeric) IS 'Receta del combo como «items» de venta, con el descuento repartido proporcionalmente para dar el precio del kit.';

-- ---------------------------------------------------------------------------
--  3. COTIZAR Y VENDER EL COMBO
-- ---------------------------------------------------------------------------
-- Totales del combo sin venderlo (pantalla de caja). Devuelve también el detalle por línea.
CREATE OR REPLACE FUNCTION fn_cotizar_combo(p_combo_id bigint, p_cantidad numeric DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE items jsonb; t record; c combos; lineas jsonb;
BEGIN
    SELECT * INTO c FROM combos WHERE id = p_combo_id AND activo;
    IF c.id IS NULL THEN RAISE EXCEPTION 'El combo % no existe o está inactivo', p_combo_id USING ERRCODE = 'TV006'; END IF;
    items := fn_combo_items(p_combo_id, p_cantidad);
    SELECT * INTO t FROM fn_cotizar_venta(items);
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'producto_id', x.producto_id, 'sku', p.sku, 'nombre', p.nombre,
                'cantidad', x.cantidad, 'descuento_pct', x.descuento_pct,
                'total_usd', l.total_usd, 'total_ves', l.total_ves) ORDER BY p.nombre), '[]'::jsonb) INTO lineas
      FROM jsonb_to_recordset(items) AS x(producto_id bigint, cantidad numeric, descuento_pct numeric)
      JOIN productos p ON p.id = x.producto_id
      CROSS JOIN LATERAL fn_calcular_linea_venta(x.cantidad, p.precio_venta_usd, x.descuento_pct,
                  p.exento_iva OR p.exonerado_iva, t.iva_pct, (SELECT precios_incluyen_iva FROM negocio WHERE id = fn_negocio_actual()), t.tasa_cambio) l;
    RETURN jsonb_build_object('combo_id', c.id, 'nombre', c.nombre, 'precio_combo_usd', c.precio_usd,
        'tasa_cambio', t.tasa_cambio, 'iva_pct', t.iva_pct,
        'base_usd', t.base_usd, 'exento_usd', t.exento_usd, 'iva_usd', t.iva_usd, 'total_usd', t.total_usd,
        'base_ves', t.base_ves, 'exento_ves', t.exento_ves, 'iva_ves', t.iva_ves, 'total_ves', t.total_ves,
        'items', items, 'lineas', lineas);
END $$;
COMMENT ON FUNCTION fn_cotizar_combo(bigint, numeric) IS 'Totales de un combo (por sus líneas reales) sin venderlo, para mostrarlos en la caja.';

-- Vende el combo: expande la receta y llama a fn_registrar_venta (16/24: caja abierta, stock, IGTF, pagos mixtos).
--   p_pagos igual que en fn_registrar_venta. Devuelve el id de la venta.
CREATE OR REPLACE FUNCTION fn_registrar_venta_combo(
    p_usuario_id bigint, p_combo_id bigint, p_cantidad numeric, p_pagos jsonb,
    p_cliente_id bigint DEFAULT NULL, p_observaciones text DEFAULT NULL, p_tipo_emision text DEFAULT 'PRESENCIAL')
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c combos; items jsonb; v_id bigint;
BEGIN
    SELECT * INTO c FROM combos WHERE id = p_combo_id AND activo;
    IF c.id IS NULL THEN RAISE EXCEPTION 'El combo % no existe o está inactivo', p_combo_id USING ERRCODE = 'TV006'; END IF;
    items := fn_combo_items(p_combo_id, p_cantidad);
    v_id := fn_registrar_venta(p_usuario_id, items, p_pagos, p_cliente_id,
        COALESCE(NULLIF(trim(p_observaciones), ''), 'Combo: ' || c.nombre),
        COALESCE(p_tipo_emision, 'PRESENCIAL'));
    RETURN v_id;
END $$;
COMMENT ON FUNCTION fn_registrar_venta_combo(bigint, bigint, numeric, jsonb, bigint, text, text) IS 'Vende un combo: la receta se expande en líneas de sus componentes con el descuento repartido y la venta se registra igual que cualquier otra.';

-- ---------------------------------------------------------------------------
--  4. CONSULTAS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_combos AS
SELECT c.id, c.sku, c.nombre, c.descripcion, c.precio_usd, c.activo,
       COALESCE(sum(p.precio_venta_usd * x.cantidad), 0) AS suma_piezas_usd,
       CASE WHEN c.precio_usd IS NOT NULL AND c.precio_usd < sum(p.precio_venta_usd * x.cantidad)
            THEN ROUND(100 - c.precio_usd / NULLIF(sum(p.precio_venta_usd * x.cantidad), 0) * 100, 2) ELSE 0 END AS ahorro_pct,
       count(x.producto_id) AS piezas,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('producto_id', p2.id, 'sku', p2.sku, 'nombre', p2.nombre,
                                                     'cantidad', x2.cantidad, 'precio_usd', p2.precio_venta_usd,
                                                     'stock', p2.stock_actual, 'exento', p2.exento_iva OR p2.exonerado_iva)
                                  ORDER BY p2.nombre)
                   FROM combo_componentes x2 JOIN productos p2 ON p2.id = x2.producto_id
                  WHERE x2.combo_id = c.id), '[]'::jsonb) AS componentes,
       COALESCE((SELECT bool_and(p2.stock_actual >= x2.cantidad) FROM combo_componentes x2 JOIN productos p2 ON p2.id = x2.producto_id), false) AS hay_stock
  FROM combos c
  LEFT JOIN combo_componentes x ON x.combo_id = c.id
  LEFT JOIN productos p ON p.id = x.producto_id
 GROUP BY c.id;
COMMENT ON VIEW v_combos IS 'Combos con sus componentes, la suma de piezas, el ahorro (%) y si hay stock completo de la receta.';
