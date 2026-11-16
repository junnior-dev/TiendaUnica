-- =============================================================================
--  23 · UNIDADES DE MEDIDA · compra por presentación, venta por unidad/pieza
-- =============================================================================
--  Requiere: 01..22 instalados (amplía productos; no modifica tablas de documentos). Es idempotente:
--     psql -d tienda -v ON_ERROR_STOP=1 -f 23_unidades_piezas.sql
--
--  Problema que resuelve (pedido del dueño): en un repuesto se COMPRA de una forma y se VENDE de otra.
--     · Compras una CAJA de 12 bujías (o un JGO de cables, un BIDON de 20 L de aceite)…
--     · …y vendes la PIEZA suelta (1 unidad).
--  La regla del sistema sigue siendo una sola: TODO el inventario (stock, kardex, compras y ventas)
--  vive en la UNIDAD DE VENTA del producto (la pieza). Lo que se agrega:
--     1. unidades_medida: catálogo de unidades válidas (UND, PAR, JGO, CAJA…) con bandera de
--        fraccionamiento. «PAR» no acepta 1.5 unidades; «LTR» sí acepta 0.5.
--     2. productos.unidad_compra + productos.piezas_por_presentacion: cómo llega la mercancía.
--        «Caja de 12»: unidad_compra = 'CAJA', piezas_por_presentacion = 12.
--        La conversión la hace fn_cantidad_en_unidades(p_producto_id, p_cantidad_compra) y la usan
--        la pantalla de compras y las órdenes de compra (archivo 26): el operador teclea «2 cajas»
--        y el sistema registra 24 unidades. El kardex y los documentos NUNCA cambian de unidad.
--     3. Validación de la pieza al vender: si la unidad del producto no admite fracciones
--        (UNA pieza, un PAR, un JGO), el trigger de detalle_venta rechaza cantidades como 0.5.
--        (Lubricantes y cintas —se venden por metro o por litro— sí aceptan fracciones.)
--     4. Las sugerencias de compra y el «por presentar» aparecen en v_productos_precios para que
--        la caja y las compras muestren «Caja × 12» junto al repuesto.
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  1. CATÁLOGO DE UNIDADES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unidades_medida (
    codigo            varchar(10) PRIMARY KEY,
    nombre            varchar(60) NOT NULL,
    permite_fraccion  boolean NOT NULL DEFAULT false,
    activa            boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE  unidades_medida IS 'Unidades de medida válidas del catálogo. permite_fraccion = TRUE admite cantidades decimales (litros, metros); FALSE exige piezas enteras.';
COMMENT ON COLUMN unidades_medida.codigo IS 'Código corto que vive en productos.unidad (UND, PAR, JGO, CAJA…).';
COMMENT ON COLUMN unidades_medida.permite_fraccion IS 'TRUE = se puede vender 0.5 (LTR, MTS, KG). FALSE = solo piezas enteras (UND, PAR, JGO, SET).';

-- Semilla: las unidades típicas de un repuesto de motos. ON CONFLICT = idempotente.
INSERT INTO unidades_medida (codigo, nombre, permite_fraccion) VALUES
    ('UND',  'Unidad / pieza',        false),
    ('PAR',  'Par',                   false),
    ('JGO',  'Juego',                 false),
    ('SET',  'Set / kit',             false),
    ('PARC', 'Par de (pedal/retén)',  false),
    ('CAJA', 'Caja / paquete',        false),
    ('LTR',  'Litro',                 true),
    ('MTS',  'Metro',                 true),
    ('KG',   'Kilogramo',             true),
    ('GLB',  'Galón',                 true)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
--  2. PRODUCTOS: presentación de compra
-- ---------------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN IF NOT EXISTS unidad_compra varchar(10);
ALTER TABLE productos ADD COLUMN IF NOT EXISTS piezas_por_presentacion numeric(14,3) NOT NULL DEFAULT 1
    CHECK (piezas_por_presentacion > 0);
COMMENT ON COLUMN productos.unidad_compra IS 'Unidad en la que llega la mercancía del proveedor (CAJA, JGO…). NULL = se compra en la misma unidad de venta.';
COMMENT ON COLUMN productos.piezas_por_presentacion IS 'Piezas de venta que trae cada presentación de compra (caja de 12 → 12). 1 = se compra y se vende en la misma unidad.';

-- Validaciones de coherencia (agregadas como función para poder usar subconsulta: un CHECK no admite SELECT).
CREATE OR REPLACE FUNCTION trg_productos_unidad() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u unidades_medida; uc unidades_medida;
BEGIN
    SELECT * INTO u FROM unidades_medida WHERE codigo = upper(trim(COALESCE(NEW.unidad, 'UND'))) AND activa;
    IF u.codigo IS NULL THEN
        RAISE EXCEPTION 'La unidad de venta "%" no está en el catálogo de unidades (tabla unidades_medida). Actívala o elige otra.', NEW.unidad USING ERRCODE = 'TV006';
    END IF;
    NEW.unidad := u.codigo;
    IF NEW.unidad_compra IS NOT NULL THEN
        SELECT * INTO uc FROM unidades_medida WHERE codigo = upper(trim(NEW.unidad_compra)) AND activa;
        IF uc.codigo IS NULL THEN
            RAISE EXCEPTION 'La unidad de compra "%" no está en el catálogo de unidades', NEW.unidad_compra USING ERRCODE = 'TV006';
        END IF;
        NEW.unidad_compra := uc.codigo;
        IF NEW.piezas_por_presentacion <= 0 THEN
            RAISE EXCEPTION 'Cada presentación de compra debe traer al menos una pieza (piezas_por_presentacion > 0)' USING ERRCODE = 'TV006';
        END IF;
    ELSE
        IF NEW.piezas_por_presentacion <> 1 THEN
            RAISE EXCEPTION 'Solo puedes indicar piezas por presentación si el producto tiene una unidad de compra distinta' USING ERRCODE = 'TV006';
        END IF;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_productos_unidad ON productos;
CREATE TRIGGER trg_productos_unidad BEFORE INSERT OR UPDATE ON productos
    FOR EACH ROW EXECUTE FUNCTION trg_productos_unidad();

-- Productos ya creados antes del 23: si su unidad no está en el catálogo, entra al catálogo sin fracciones
-- (no cambia la unidad del producto: solo se legaliza en el catálogo para que el trigger no la rechace).
INSERT INTO unidades_medida (codigo, nombre, permite_fraccion)
SELECT DISTINCT upper(trim(p.unidad)), 'Unidad registrada antes del catálogo', false
  FROM productos p
  LEFT JOIN unidades_medida u ON u.codigo = upper(trim(p.unidad))
 WHERE u.codigo IS NULL
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
--  3. CONVERSIÓN COMPRA → PIEZAS (una sola fórmula en todo el sistema)
-- ---------------------------------------------------------------------------
-- Cantidad en unidades de VENTA que resultan de comprar p_cantidad presentaciones del producto.
--   fn_cantidad_en_unidades(1, 2)      → 2   (se compra en unidades)
--   fn_cantidad_en_unidades(2, 1.5)    → 3   (caja de 2: 1,5 cajas = 3 piezas)
CREATE OR REPLACE FUNCTION fn_cantidad_en_unidades(p_producto_id bigint, p_cantidad_compra numeric)
RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p.unidad_compra IS NULL THEN p_cantidad_compra
                ELSE ROUND(p_cantidad_compra * p.piezas_por_presentacion, 3) END
      FROM productos p WHERE p.id = p_producto_id
$$;
COMMENT ON FUNCTION fn_cantidad_en_unidades(bigint, numeric) IS 'Convierte una cantidad comprada en presentaciones (cajas/juegos) a unidades de venta (piezas). Sin presentación, devuelve la misma cantidad.';

-- Presentaciones equivalentes a una cantidad de piezas (para el listado de compras: «12 UND = 1 CAJA»).
CREATE OR REPLACE FUNCTION fn_cantidad_en_presentaciones(p_producto_id bigint, p_cantidad_piezas numeric)
RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p.unidad_compra IS NULL THEN NULL
                ELSE ROUND(p_cantidad_piezas / p.piezas_por_presentacion, 3) END
      FROM productos p WHERE p.id = p_producto_id
$$;
COMMENT ON FUNCTION fn_cantidad_en_presentaciones(bigint, numeric) IS 'Convierte piezas a presentaciones de compra (NULL si el producto no tiene presentación distinta).';

-- ---------------------------------------------------------------------------
--  4. VENTA POR PIEZA: rechazar fracciones en unidades que no las admiten
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_detalle_venta_unidad() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u unidades_medida;
BEGIN
    SELECT * INTO u FROM unidades_medida WHERE codigo = (SELECT unidad FROM productos WHERE id = NEW.producto_id);
    IF u.codigo IS NOT NULL AND NOT u.permite_fraccion AND NEW.cantidad <> floor(NEW.cantidad) THEN
        RAISE EXCEPTION 'El producto se vende por % (pieza completa): la cantidad %.3 no es válida. Usa cantidades enteras o marca el producto con una unidad fraccionable (LTR, MTS, KG).',
            u.nombre, NEW.cantidad USING ERRCODE = 'TV006';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_detalle_venta_unidad ON detalle_venta;
CREATE TRIGGER trg_detalle_venta_unidad BEFORE INSERT ON detalle_venta
    FOR EACH ROW EXECUTE FUNCTION trg_detalle_venta_unidad();

-- ---------------------------------------------------------------------------
--  5. VISIBILIDAD: el catálogo y la caja ven la presentación de compra
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_productos_presentacion AS
SELECT p.id AS producto_id, p.sku, p.nombre, p.unidad, p.unidad_compra, p.piezas_por_presentacion,
       u.nombre AS unidad_compra_nombre,
       CASE WHEN p.unidad_compra IS NULL THEN NULL
            ELSE p.unidad_compra || ' × ' || trim(to_char(p.piezas_por_presentacion, 'FM999999990.###')) END AS etiqueta_presentacion
  FROM productos p
  LEFT JOIN unidades_medida u ON u.codigo = p.unidad_compra;
COMMENT ON VIEW v_productos_presentacion IS 'Presentación de compra de cada producto («CAJA × 12») para mostrarla en compras, órdenes y sugerencias.';

-- ---------------------------------------------------------------------------
--  Documentación
-- ---------------------------------------------------------------------------
COMMENT ON FUNCTION trg_productos_unidad() IS 'Valida unidad y unidad_compra contra el catálogo unidades_medida y normaliza el código (mayúsculas).';
COMMENT ON TRIGGER trg_productos_unidad ON productos IS 'Unidad de venta y de compra contra el catálogo (archivo 23).';
COMMENT ON TRIGGER trg_detalle_venta_unidad ON detalle_venta IS 'Rechaza cantidades fraccionadas en productos cuya unidad no admite fracciones (archivo 23).';
