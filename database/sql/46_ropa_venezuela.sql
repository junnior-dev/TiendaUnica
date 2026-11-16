-- =============================================================
--  46_ropa_venezuela.sql
--  Módulo vertical para tiendas de ropa y boutiques
-- =============================================================

SET search_path = tienda, public;

-- -------------------------------------------------------------------
--  1. TABLA DE TALLAS
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tallas (
    codigo VARCHAR(10) PRIMARY KEY,
    nombre VARCHAR(30) NOT NULL,
    orden SMALLINT NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE tallas IS 'Catálogo de tallas para ropa. El campo "orden" define el orden de presentación en el POS.';

INSERT INTO tallas (codigo, nombre, orden) VALUES
    -- Tallas estándar
    ('XS', 'Extra Small', 1),
    ('S', 'Small', 2),
    ('M', 'Medium', 3),
    ('L', 'Large', 4),
    ('XL', 'Extra Large', 5),
    ('XXL', 'XX Large', 6),
    ('XXXL', 'XXX Large', 7),
    -- Tallas numéricas (pantalones, zapatos)
    ('26', '26', 10),
    ('28', '28', 11),
    ('30', '30', 12),
    ('32', '32', 13),
    ('34', '34', 14),
    ('36', '36', 15),
    ('38', '38', 16),
    ('40', '40', 17),
    ('42', '42', 18),
    ('44', '44', 19),
    ('46', '46', 20),
    ('48', '48', 21),
    -- Talla única
    ('UNI', 'Única', 99),
    -- Infantil
    ('2A', '2 Años', 30),
    ('4A', '4 Años', 31),
    ('6A', '6 Años', 32),
    ('8A', '8 Años', 33),
    ('10A', '10 Años', 34),
    ('12A', '12 Años', 35)
ON CONFLICT (codigo) DO NOTHING;

-- -------------------------------------------------------------------
--  2. TABLA DE COLORES
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS colores (
    codigo VARCHAR(20) PRIMARY KEY,
    nombre VARCHAR(40) NOT NULL
);

COMMENT ON TABLE colores IS 'Catálogo de colores para ropa.';

INSERT INTO colores (codigo, nombre) VALUES
    ('NEGRO', 'Negro'),
    ('BLANCO', 'Blanco'),
    ('AZUL_MARINO', 'Azul Marino'),
    ('AZUL', 'Azul'),
    ('AZUL_CLARO', 'Azul Claro'),
    ('ROJO', 'Rojo'),
    ('ROJO_VINO', 'Rojo Vino'),
    ('VERDE', 'Verde'),
    ('VERDE_MILITAR', 'Verde Militar'),
    ('AMARILLO', 'Amarillo'),
    ('GRIS', 'Gris'),
    ('GRIS_OSCURO', 'Gris Oscuro'),
    ('BEIGE', 'Beige'),
    ('CREMA', 'Crema'),
    ('ROSADO', 'Rosado'),
    ('FUCSIA', 'Fucsia'),
    ('MORADO', 'Morado'),
    ('LILA', 'Lila'),
    ('NARANJA', 'Naranja'),
    ('CAFÉ', 'Café'),
    ('CAFÉ_CLARO', 'Café Claro'),
    ('NEGRO_BLANCO', 'Negro/Blanco'),
    ('ESTAMPADO', 'Estampado'),
    ('CUADROS', 'Cuadros'),
    ('RAYAS', 'Rayas')
ON CONFLICT (codigo) DO NOTHING;

-- -------------------------------------------------------------------
--  3. VARIANTES DE PRODUCTO (TALLA + COLOR)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS producto_variantes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    producto_id BIGINT NOT NULL REFERENCES productos(id),
    talla VARCHAR(10) NOT NULL,
    color VARCHAR(20) NOT NULL,
    codigo_barras VARCHAR(40),
    sku_variante VARCHAR(60),
    stock_actual NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),
    costo_usd NUMERIC(18,4),
    precio_venta_usd NUMERIC(18,4),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    negocio_id INTEGER NOT NULL REFERENCES negocio(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_variante UNIQUE (negocio_id, producto_id, talla, color)
);

CREATE INDEX IF NOT EXISTS ix_variantes_producto ON producto_variantes (producto_id);
CREATE INDEX IF NOT EXISTS ix_variantes_barras ON producto_variantes (codigo_barras) WHERE codigo_barras IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_variantes_stock ON producto_variantes (producto_id, stock_actual) WHERE activo;

COMMENT ON TABLE producto_variantes IS 'Variantes de ropa por talla y color. El stock se controla aquí, no en la tabla productos padre.';
COMMENT ON COLUMN producto_variantes.sku_variante IS 'SKU específico de la variante. Ejemplo: CAMISA-001-M-NEGRO';
COMMENT ON COLUMN producto_variantes.costo_usd IS 'Costo específico de la variante (puede diferir del producto padre). NULL = usa el del padre.';

-- -------------------------------------------------------------------
--  4. NOTA DE ARQUITECTURA: STOCK EN PRODUCTO PADRE VS. VARIANTES
-- -------------------------------------------------------------------
-- IMPORTANTE: En este sistema (03_triggers.sql:140 y 392):
--   a) trg_productos_antes() BLOQUEA cualquier UPDATE directo de
--      productos.stock_actual salvo que venga del kardex (tienda.mov_stock = '1').
--   b) Al insertar en detalle_venta, trg_detalle_venta_despues() inserta en
--      movimientos_inventario, lo que YA descuenta el stock_actual del padre.
-- Por eso NO debe existir un trigger en producto_variantes que haga
-- UPDATE productos SET stock_actual = SUM(...), porque chocará con el kardex
-- o descontará dos veces al vender. El stock total se mueve por el kardex
-- (sp_ajustar_stock / compras / ventas) y producto_variantes lleva solo el
-- desglose por talla/color.

-- -------------------------------------------------------------------
--  5. AJUSTAR DETALLE DE VENTA PARA VARIANTES
-- -------------------------------------------------------------------
ALTER TABLE detalle_venta ADD COLUMN IF NOT EXISTS variante_id BIGINT REFERENCES producto_variantes(id);

COMMENT ON COLUMN detalle_venta.variante_id IS 'Para ropa: referencia a la variante talla+color específica vendida. NULL para productos sin variantes.';

-- -------------------------------------------------------------------
--  6. TRIGGER: VENTA DE VARIANTE ACTUALIZA SU STOCK
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_venta_variante() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.variante_id IS NOT NULL THEN
        UPDATE producto_variantes
           SET stock_actual = stock_actual - NEW.cantidad,
               updated_at = now()
         WHERE id = NEW.variante_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venta_variante ON detalle_venta;
CREATE TRIGGER trg_venta_variante
    AFTER INSERT ON detalle_venta
    FOR EACH ROW
    EXECUTE FUNCTION trg_venta_variante();

-- -------------------------------------------------------------------
--  7. CATEGORÍAS DE ROPA VENEZOLANA
-- -------------------------------------------------------------------
INSERT INTO categorias (negocio_id, nombre, margen_pct)
SELECT 1, v.nombre, v.margen_pct
  FROM (VALUES
    ('Camisas', 50),
    ('Pantalones', 45),
    ('Vestidos', 55),
    ('Shorts', 48),
    ('Trajes de Baño', 60),
    ('Ropa Interior', 35),
    ('Zapatos', 40),
    ('Bolsos', 55),
    ('Accesorios', 65),
    ('Ropa Deportiva', 48),
    ('Uniformes Escolares', 30),
    ('Uniformes Corporativos', 35),
    ('Jeans', 42),
    ('Franelas', 52),
    ('Blusas', 53),
    ('Faldas', 50),
    ('Trajes', 70),
    ('Ropa de Bebé', 45)
  ) AS v(nombre, margen_pct)
 WHERE NOT EXISTS (
    SELECT 1 FROM categorias c WHERE c.negocio_id = 1 AND lower(c.nombre) = lower(v.nombre)
 );

-- -------------------------------------------------------------------
--  8. TEMPORADAS
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS temporadas (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre VARCHAR(40) NOT NULL,
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    negocio_id INTEGER NOT NULL DEFAULT 1 REFERENCES negocio(id),
    CONSTRAINT ck_temporada_fechas CHECK (fecha_fin >= fecha_inicio)
);

CREATE INDEX IF NOT EXISTS ix_temporadas_activas ON temporadas (negocio_id, fecha_inicio, fecha_fin) WHERE activa;

COMMENT ON TABLE temporadas IS 'Temporadas de ropa: Verano, Invierno, Escolar, Navideña, Black Friday, etc.';

-- -------------------------------------------------------------------
--  9. VISTA PARA EL POS: PRODUCTOS CON VARIANTES
-- -------------------------------------------------------------------
CREATE OR REPLACE VIEW v_productos_ropa AS
SELECT p.id AS producto_id,
       p.sku,
       p.nombre,
       p.categoria_id,
       c.nombre AS categoria,
       v.id AS variante_id,
       v.talla,
       v.color,
       v.codigo_barras,
       v.sku_variante,
       COALESCE(v.precio_venta_usd, p.precio_venta_usd) AS precio_usd,
       v.stock_actual AS stock_variante,
       CASE WHEN v.id IS NULL THEN p.stock_actual ELSE v.stock_actual END AS stock_disponible
  FROM productos p
  LEFT JOIN producto_variantes v ON v.producto_id = p.id AND v.activo
  LEFT JOIN categorias c ON c.id = p.categoria_id
 WHERE p.activo
 ORDER BY p.nombre, v.talla, v.color;

COMMENT ON VIEW v_productos_ropa IS 'Vista para el POS de ropa: muestra cada variante (talla+color) como una línea seleccionable.';

-- -------------------------------------------------------------------
--  10. FUNCIÓN: CREAR VARIANTE AUTOMÁTICAMENTE
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_crear_variantes_producto(
    p_producto_id BIGINT,
    p_tallas TEXT[],
    p_colores TEXT[],
    p_precio_base_usd NUMERIC DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
    t TEXT;
    c TEXT;
    contador INTEGER := 0;
    precio NUMERIC;
BEGIN
    -- Obtener precio base
    SELECT COALESCE(p_precio_base_usd, precio_venta_usd) INTO precio
      FROM productos WHERE id = p_producto_id;

    IF precio IS NULL THEN
        RAISE EXCEPTION 'El producto no tiene precio de venta' USING ERRCODE = 'TV006';
    END IF;

    -- Crear combinaciones talla × color
    FOREACH t IN ARRAY p_tallas LOOP
        FOREACH c IN ARRAY p_colores LOOP
            INSERT INTO producto_variantes (producto_id, talla, color, precio_venta_usd, negocio_id)
            VALUES (p_producto_id, t, c, precio, fn_negocio_actual())
            ON CONFLICT (negocio_id, producto_id, talla, color) DO NOTHING;

            contador := contador + 1;
        END LOOP;
    END LOOP;

    RETURN contador;
END;
$$;

COMMENT ON FUNCTION fn_crear_variantes_producto(bigint, text[], text[], numeric) IS 'Crea automáticamente todas las combinaciones talla×color para un producto. Devuelve el número de variantes creadas.';

-- Ejemplo de uso:
-- SELECT fn_crear_variantes_producto(123, ARRAY['S','M','L','XL'], ARRAY['NEGRO','AZUL_MARINO','BLANCO'], 25.00);

-- -------------------------------------------------------------------
--  11. FUNCIÓN: REPORTE DE VENTAS POR TALLA
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ventas_por_talla(
    p_desde DATE,
    p_hasta DATE,
    p_categoria_id BIGINT DEFAULT NULL
)
RETURNS TABLE (
    talla VARCHAR,
    unidades_vendidas NUMERIC,
    ingreso_usd NUMERIC,
    porcentaje NUMERIC
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    WITH por_talla AS (
        SELECT pv.talla AS talla_cod,
               SUM(d.cantidad) AS unidades,
               SUM(d.total_usd) AS ingreso
          FROM detalle_venta d
          JOIN ventas v ON v.id = d.venta_id AND v.estado = 'COMPLETADA'
                       AND v.fecha_valor BETWEEN p_desde AND p_hasta
          JOIN producto_variantes pv ON pv.id = d.variante_id
          LEFT JOIN productos p ON p.id = d.producto_id
         WHERE d.variante_id IS NOT NULL
           AND (p_categoria_id IS NULL OR p.categoria_id = p_categoria_id)
         GROUP BY pv.talla
    )
    SELECT pt.talla_cod,
           pt.unidades,
           pt.ingreso,
           ROUND(100.0 * pt.unidades / NULLIF(SUM(pt.unidades) OVER (), 0), 2) AS pct
      FROM por_talla pt
     ORDER BY pt.unidades DESC;
END;
$$;

COMMENT ON FUNCTION fn_ventas_por_talla(date, date, bigint) IS 'Reporte de ventas desglosado por talla. Útil para identificar qué tallas se venden más.';
