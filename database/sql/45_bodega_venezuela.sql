-- =============================================================
--  45_bodega_venezuela.sql
--  Módulo vertical para bodegas y abarrotes
-- =============================================================

SET search_path = tienda, public;

-- -------------------------------------------------------------------
--  1. CONTROL DE LOTES Y CADUCIDAD
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS producto_lotes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    producto_id BIGINT NOT NULL REFERENCES productos(id),
    lote VARCHAR(60) NOT NULL,
    fecha_elaboracion DATE,
    fecha_caducidad DATE NOT NULL,
    cantidad NUMERIC(14,3) NOT NULL CHECK (cantidad >= 0),
    costo_unitario_usd NUMERIC(18,4),
    ubicacion VARCHAR(40),
    proveedor_id BIGINT REFERENCES proveedores(id),
    negocio_id INTEGER NOT NULL REFERENCES negocio(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_lote UNIQUE (negocio_id, producto_id, lote, fecha_caducidad)
);

CREATE INDEX IF NOT EXISTS ix_lotes_producto ON producto_lotes (producto_id);
CREATE INDEX IF NOT EXISTS ix_lotes_caducidad ON producto_lotes (fecha_caducidad) WHERE cantidad > 0;
CREATE INDEX IF NOT EXISTS ix_lotes_ubicacion ON producto_lotes (ubicacion) WHERE ubicacion IS NOT NULL;

COMMENT ON TABLE producto_lotes IS 'Control de lotes y caducidad para productos perecederos. El sistema usa FIFO automático por fecha de caducidad al vender.';
COMMENT ON COLUMN producto_lotes.lote IS 'Número de lote del proveedor. Puede repetirse entre productos.';
COMMENT ON COLUMN producto_lotes.fecha_caducidad IS 'Fecha de vencimiento del lote. Obligatoria para productos perecederos.';
COMMENT ON COLUMN producto_lotes.ubicacion IS 'Ubicación física en el almacén (estante, pasillo, nevera, etc.).';

-- -------------------------------------------------------------------
--  2. ALERTA DE PRODUCTOS PRÓXIMOS A CADUCAR
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_productos_a_caducar(
    p_dias INTEGER DEFAULT 30,
    p_negocio_id INTEGER DEFAULT NULL
)
RETURNS TABLE (
    producto_id BIGINT,
    producto VARCHAR,
    lote VARCHAR,
    fecha_caducidad DATE,
    dias_restantes INTEGER,
    cantidad NUMERIC,
    valor_usd NUMERIC,
    ubicacion VARCHAR
)
LANGUAGE sql STABLE AS $$
    SELECT pl.producto_id,
           p.nombre,
           pl.lote,
           pl.fecha_caducidad,
           (pl.fecha_caducidad - fn_hoy())::INTEGER,
           pl.cantidad,
           ROUND(pl.cantidad * COALESCE(pl.costo_unitario_usd, p.costo_usd), 2),
           pl.ubicacion
      FROM producto_lotes pl
      JOIN productos p ON p.id = pl.producto_id
     WHERE pl.fecha_caducidad <= fn_hoy() + p_dias
       AND pl.cantidad > 0
       AND (p_negocio_id IS NULL OR pl.negocio_id = p_negocio_id)
     ORDER BY pl.fecha_caducidad, pl.cantidad DESC;
$$;

COMMENT ON FUNCTION fn_productos_a_caducar(integer, integer) IS 'Lista productos que caducan en los próximos N días. Ordenado por urgencia.';

-- -------------------------------------------------------------------
--  3. TRIGGER: VENTA CON FIFO POR FECHA DE CADUCIDAD
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_venta_fifo_caducidad() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    lote record;
    cantidad_pendiente NUMERIC := NEW.cantidad;
    cantidad_a_descontar NUMERIC;
BEGIN
    -- Solo para productos con control de lotes
    IF EXISTS (SELECT 1 FROM producto_lotes WHERE producto_id = NEW.producto_id AND cantidad > 0) THEN

        -- Procesar lotes en orden FIFO (más próximo a caducar primero)
        FOR lote IN
            SELECT id, lote, cantidad, costo_unitario_usd
              FROM producto_lotes
             WHERE producto_id = NEW.producto_id
               AND cantidad > 0
             ORDER BY fecha_caducidad ASC
             FOR UPDATE
        LOOP
            IF cantidad_pendiente <= 0 THEN
                EXIT;
            END IF;

            -- Calcular cuánto tomar de este lote
            cantidad_a_descontar := LEAST(lote.cantidad, cantidad_pendiente);

            -- Descontar del lote
            UPDATE producto_lotes
               SET cantidad = cantidad - cantidad_a_descontar
             WHERE id = lote.id;

            -- Registrar el costo del lote (para Kardex y costo de ventas)
            IF cantidad_pendiente = NEW.cantidad THEN
                -- Primera iteración: usar el costo del primer lote
                NEW.costo_unitario_usd := lote.costo_unitario_usd;
            END IF;

            cantidad_pendiente := cantidad_pendiente - cantidad_a_descontar;
        END LOOP;

        -- Si no alcanzó el stock de todos los lotes
        IF cantidad_pendiente > 0 THEN
            RAISE EXCEPTION 'Stock insuficiente en lotes para el producto %. Faltan % unidades',
                NEW.producto_id, cantidad_pendiente USING ERRCODE = 'TV003';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_venta_fifo_caducidad ON detalle_venta;
CREATE TRIGGER trg_venta_fifo_caducidad
    BEFORE INSERT ON detalle_venta
    FOR EACH ROW
    EXECUTE FUNCTION trg_venta_fifo_caducidad();

-- -------------------------------------------------------------------
--  4. MARCAR PRODUCTO COMO PERECEDERO
-- -------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN IF NOT EXISTS es_perecedero BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE productos ADD COLUMN IF NOT EXISTS dias_vida_util INTEGER;

COMMENT ON COLUMN productos.es_perecedero IS 'TRUE para productos que caducan (alimentos, medicinas, cosméticos). Activa el control de lotes.';
COMMENT ON COLUMN productos.dias_vida_util IS 'Días de vida útil típicos del producto. Útil para alertas proactivas.';

-- -------------------------------------------------------------------
--  5. CATEGORÍAS DE BODEGA VENEZOLANA
-- -------------------------------------------------------------------
INSERT INTO categorias (negocio_id, nombre, margen_pct)
SELECT 1, v.nombre, v.margen_pct
  FROM (VALUES
    ('Abarrotes', 20),
    ('Arroz y Pastas', 18),
    ('Harinas y Cereales', 22),
    ('Aceites y Grasas', 25),
    ('Lácteos y Derivados', 15),
    ('Bebidas No Alcohólicas', 28),
    ('Bebidas Alcohólicas', 35),
    ('Limpieza del Hogar', 30),
    ('Higiene Personal', 32),
    ('Charcutería y Embutidos', 18),
    ('Carnes y Pollo', 12),
    ('Frutas y Verduras', 10),
    ('Condimentos y Especias', 35),
    ('Conservas y Enlatados', 25),
    ('Confitería y Dulces', 38),
    ('Helados', 22),
    ('Panadería', 15),
    ('Mascotas', 28)
  ) AS v(nombre, margen_pct)
 WHERE NOT EXISTS (
    SELECT 1 FROM categorias c WHERE c.negocio_id = 1 AND lower(c.nombre) = lower(v.nombre)
 );

-- -------------------------------------------------------------------
--  6. MARCAS DE BODEGA VENEZOLANA
-- -------------------------------------------------------------------
INSERT INTO marcas (negocio_id, nombre)
SELECT 1, v.nombre
  FROM (VALUES
    ('Empresas Polar'),
    ('Alimentos Mary'),
    ('Mavesa'),
    ('Ron Santa Teresa'),
    ('Cervecería Regional'),
    ('Cervecería Polar'),
    ('PepsiCo Venezuela'),
    ('Coca-Cola FEMSA'),
    ('Nestlé Venezuela'),
    ('Alimentos Heinz'),
    ('Fábrica de Galletas La Comercial'),
    ('Manapa'),
    ('Venoco'),
    ('Lácteos Los Andes'),
    ('Inlaca'),
    ('Planta'),
    ('Rikesa'),
    ('Alimentos Capri'),
    ('Venevizia')
  ) AS v(nombre)
 WHERE NOT EXISTS (
    SELECT 1 FROM marcas m WHERE m.negocio_id = 1 AND lower(m.nombre) = lower(v.nombre)
 );

-- -------------------------------------------------------------------
--  7. FUNCIÓN: RECIBIR COMPRA CON LOTES
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_recibir_compra_con_lotes(
    p_compra_id BIGINT,
    p_lotes JSONB  -- [{"producto_id": 1, "lote": "L001", "fecha_caducidad": "2026-12-31", "ubicacion": "A-01"}]
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    l record;
BEGIN
    FOR l IN SELECT * FROM jsonb_to_recordset(p_lotes) AS x(
        producto_id BIGINT,
        lote VARCHAR,
        fecha_caducidad DATE,
        ubicacion VARCHAR
    ) LOOP
        -- Obtener cantidad y costo del detalle de compra
        INSERT INTO producto_lotes (producto_id, lote, fecha_caducidad, cantidad, costo_unitario_usd, ubicacion, negocio_id)
        SELECT cd.producto_id, l.lote, l.fecha_caducidad, cd.cantidad, cd.costo_unitario_usd, l.ubicacion, fn_negocio_actual()
          FROM compra_detalle cd
         WHERE cd.compra_id = p_compra_id AND cd.producto_id = l.producto_id
        ON CONFLICT (negocio_id, producto_id, lote, fecha_caducidad)
        DO UPDATE SET cantidad = producto_lotes.cantidad + EXCLUDED.cantidad;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION fn_recibir_compra_con_lotes(bigint, jsonb) IS 'Registra lotes al recibir una compra. Se llama después de registrar la compra normal.';

-- -------------------------------------------------------------------
--  8. VISTA: STOCK POR LOTE
-- -------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stock_por_lote AS
SELECT p.id AS producto_id,
       p.sku,
       p.nombre,
       p.categoria_id,
       c.nombre AS categoria,
       pl.id AS lote_id,
       pl.lote,
       pl.fecha_caducidad,
       pl.cantidad AS stock_lote,
       (pl.fecha_caducidad - fn_hoy())::INTEGER AS dias_para_caducar,
       pl.ubicacion,
       CASE
           WHEN pl.fecha_caducidad < fn_hoy() THEN 'CADUCADO'
           WHEN pl.fecha_caducidad <= fn_hoy() + 7 THEN 'URGENTE'
           WHEN pl.fecha_caducidad <= fn_hoy() + 30 THEN 'PRÓXIMO'
           ELSE 'OK'
       END AS estado_caducidad
  FROM productos p
  JOIN producto_lotes pl ON pl.producto_id = p.id
  LEFT JOIN categorias c ON c.id = p.categoria_id
 WHERE pl.cantidad > 0
 ORDER BY pl.fecha_caducidad;

COMMENT ON VIEW v_stock_por_lote IS 'Stock desglosado por lote con estado de caducidad.';

-- -------------------------------------------------------------------
--  9. REPORTES DE BODEGA
-- -------------------------------------------------------------------

-- Reporte: Productos caducados
CREATE OR REPLACE VIEW v_productos_caducados AS
SELECT p.id, p.sku, p.nombre, pl.lote, pl.fecha_caducidad,
       pl.cantidad, pl.ubicacion,
       ROUND(pl.cantidad * p.costo_usd, 2) AS valor_perdido_usd
  FROM producto_lotes pl
  JOIN productos p ON p.id = pl.producto_id
 WHERE pl.fecha_caducidad < fn_hoy()
   AND pl.cantidad > 0
 ORDER BY pl.fecha_caducidad;

COMMENT ON VIEW v_productos_caducados IS 'Productos ya caducados que aún están en inventario. Deben darse de baja.';

-- Reporte: Rotación por lote
CREATE OR REPLACE FUNCTION fn_rotacion_por_lote(
    p_meses INTEGER DEFAULT 3
)
RETURNS TABLE (
    producto_id BIGINT,
    producto VARCHAR,
    lote VARCHAR,
    stock_inicial NUMERIC,
    ventas NUMERIC,
    rotacion NUMERIC
)
LANGUAGE sql STABLE AS $$
    WITH ventas_lote AS (
        -- Aproximación: ventas totales del producto divididas entre lotes activos
        SELECT d.producto_id, SUM(d.cantidad) AS total_vendido
          FROM detalle_venta d
          JOIN ventas v ON v.id = d.venta_id
                        AND v.estado = 'COMPLETADA'
                        AND v.fecha_valor >= fn_hoy() - (p_meses || ' months')::interval
         WHERE EXISTS (SELECT 1 FROM producto_lotes WHERE producto_id = d.producto_id)
         GROUP BY d.producto_id
    )
    SELECT pl.producto_id,
           p.nombre,
           pl.lote,
           pl.cantidad AS stock_inicial,
           COALESCE(vl.total_vendido / NULLIF((SELECT COUNT(*) FROM producto_lotes pl2 WHERE pl2.producto_id = pl.producto_id), 0), 0) AS ventas,
           CASE WHEN pl.cantidad > 0
                THEN COALESCE(vl.total_vendido / NULLIF((SELECT COUNT(*) FROM producto_lotes pl2 WHERE pl2.producto_id = pl.producto_id), 0), 0) / pl.cantidad
                END AS rotacion
      FROM producto_lotes pl
      JOIN productos p ON p.id = pl.producto_id
      LEFT JOIN ventas_lote vl ON vl.producto_id = pl.producto_id
     WHERE pl.cantidad > 0
     ORDER BY rotacion DESC;
$$;
