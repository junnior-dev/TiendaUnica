-- =============================================================
--  44_ferreteria_venezuela.sql
--  Módulo vertical para ferreterías
-- =============================================================

SET search_path = tienda, public;

-- -------------------------------------------------------------------
--  1. TABLA DE COMPATIBILIDAD (NO renombrar motos_modelos)
-- -------------------------------------------------------------------
-- IMPORTANTE: NO hacer ALTER TABLE motos_modelos RENAME TO equipos_modelos.
-- La vista v_compatibilidad (04_vistas.sql), encargos (24_encargos.sql) y los
-- controladores ModelosController, CompatibilidadController, MarcasController y
-- ProductosController consultan "motos_modelos" por nombre. Se mantiene el nombre
-- físico (con una vista alias opcional) y solo se cambia la etiqueta en la UI.
COMMENT ON TABLE motos_modelos IS 'Modelos de motos o equipos (taladros, sierras, compresores) para compatibilidad de repuestos.';
CREATE OR REPLACE VIEW equipos_modelos AS SELECT * FROM motos_modelos;

-- -------------------------------------------------------------------
--  2. AGREGAR DIMENSIONES FÍSICAS A PRODUCTOS
-- -------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN IF NOT EXISTS peso_kg NUMERIC(8,3);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS dimensiones_cm VARCHAR(30); -- "30x20x15"

COMMENT ON COLUMN productos.peso_kg IS 'Peso del producto en kilogramos (útil para envíos y cálculo de flete).';
COMMENT ON COLUMN productos.dimensiones_cm IS 'Dimensiones en formato "largo x ancho x alto" en centímetros.';

-- -------------------------------------------------------------------
--  3. ESPECIFICACIONES TÉCNICAS (JSONB FLEXIBLE)
-- -------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN IF NOT EXISTS especificaciones JSONB DEFAULT '{}';

COMMENT ON COLUMN productos.especificaciones IS 'Especificaciones técnicas del producto en formato JSON. Ejemplo: {"voltaje": "120V", "potencia_w": 750, "rpm": 3000, "material": "acero inoxidable", "garantia_meses": 12}';

-- Ejemplo de uso:
-- UPDATE productos
-- SET especificaciones = '{"voltaje": "120V", "potencia_w": 750, "rpm": 3000}'::jsonb
-- WHERE id = 123;

-- -------------------------------------------------------------------
--  4. CATEGORÍAS DE FERRETERÍA VENEZOLANA
-- -------------------------------------------------------------------
-- Nota: el índice único es expresional (uq_neg_categorias_nombre sobre
-- negocio_id, lower(nombre)); usamos WHERE NOT EXISTS para idempotencia.
INSERT INTO categorias (negocio_id, nombre, margen_pct)
SELECT 1, v.nombre, v.margen_pct
  FROM (VALUES
    ('Herramientas Eléctricas', 35),
    ('Herramientas Manuales', 40),
    ('Tornillería y Fijación', 25),
    ('Fontanería y Plomería', 30),
    ('Electricidad', 32),
    ('Pinturas y Acabados', 38),
    ('Soldadura', 28),
    ('Seguridad Industrial', 45),
    ('Construcción', 22),
    ('Herrería', 30),
    ('Carpintería', 33),
    ('Jardinería', 28),
    ('Adhesivos y Selladores', 42),
    ('Medición y Precisión', 48)
  ) AS v(nombre, margen_pct)
 WHERE NOT EXISTS (
    SELECT 1 FROM categorias c WHERE c.negocio_id = 1 AND lower(c.nombre) = lower(v.nombre)
 );

-- -------------------------------------------------------------------
--  5. NUEVAS UNIDADES DE MEDIDA FERRETERA
-- -------------------------------------------------------------------
-- La PK compuesta creada en 31 es (negocio_id, codigo).
INSERT INTO unidades_medida (negocio_id, codigo, nombre, permite_fraccion) VALUES
    (1, 'PZA', 'Pieza', false),
    (1, 'KIT', 'Kit', false),
    (1, 'ROL', 'Rollo', false),
    (1, 'LAM', 'Lámina', false),
    (1, 'TUB', 'Tubo', false),
    (1, 'PLK', 'Paquete', false),
    (1, 'SAC', 'Saco', false),
    (1, 'BOL', 'Bolsa', false),
    (1, 'VAR', 'Varilla', false),
    (1, 'MTR', 'Metro lineal', true),
    (1, 'M2', 'Metro cuadrado', true),
    (1, 'PUL', 'Pulgada', true)
ON CONFLICT (negocio_id, codigo) DO NOTHING;

-- -------------------------------------------------------------------
--  6. MARCAS DE FERRETERÍA
-- -------------------------------------------------------------------
INSERT INTO marcas (negocio_id, nombre)
SELECT 1, v.nombre
  FROM (VALUES
    ('Bosch'), ('DeWalt'), ('Stanley'), ('Makita'), ('Coro'),
    ('Black+Decker'), ('Truper'), ('Cumberland'), ('Venoco'),
    ('Irwin'), ('Vonder'), ('Eletrônica'), ('Parada')
  ) AS v(nombre)
 WHERE NOT EXISTS (
    SELECT 1 FROM marcas m WHERE m.negocio_id = 1 AND lower(m.nombre) = lower(v.nombre)
 );

-- -------------------------------------------------------------------
--  7. FUNCIÓN: PRODUCTOS CON ESPECIFICACIONES TÉCNICAS
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_productos_con_especificaciones(
    p_categoria_id BIGINT DEFAULT NULL,
    p_busqueda TEXT DEFAULT NULL
)
RETURNS TABLE (
    id BIGINT,
    sku VARCHAR,
    nombre VARCHAR,
    categoria VARCHAR,
    marca VARCHAR,
    precio_usd NUMERIC,
    stock NUMERIC,
    especificaciones JSONB
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    SELECT p.id, p.sku, p.nombre, c.nombre, m.nombre,
           p.precio_venta_usd, p.stock_actual, p.especificaciones
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      LEFT JOIN marcas m ON m.id = p.marca_id
     WHERE p.activo
       AND (p_categoria_id IS NULL OR p.categoria_id = p_categoria_id)
       AND (p_busqueda IS NULL OR p.nombre ILIKE '%' || p_busqueda || '%')
     ORDER BY p.nombre;
END;
$$;

COMMENT ON FUNCTION fn_productos_con_especificaciones(bigint, text) IS 'Lista productos con sus especificaciones técnicas (ferretería).';

-- -------------------------------------------------------------------
--  8. TRIGGER: VALIDAR ESPECIFICACIONES TÉCNICAS
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_validar_especificaciones() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Validar que especificaciones sea un JSON válido
    IF NEW.especificaciones IS NOT NULL AND jsonb_typeof(NEW.especificaciones) IS NULL THEN
        RAISE EXCEPTION 'Las especificaciones deben ser un JSON válido' USING ERRCODE = 'TV006';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_especificaciones ON productos;
CREATE TRIGGER trg_validar_especificaciones
    BEFORE INSERT OR UPDATE ON productos
    FOR EACH ROW
    EXECUTE FUNCTION trg_validar_especificaciones();
