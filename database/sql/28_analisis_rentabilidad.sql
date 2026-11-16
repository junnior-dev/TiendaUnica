-- =============================================================================
--  28 · ANÁLISIS DE INVENTARIO Y RENTABILIDAD (ABC · rotación · categoría · cliente)
-- =============================================================================
--  Requiere: 01..24 (notas de crédito con detalle: 12). Es idempotente:
--     psql -d tienda -v ON_ERROR_STOP=1 -f 28_analisis_rentabilidad.sql
--
--  Cuatro funciones de decisión (todas reciben desde/hasta y son solo LECTURA):
--
--   fn_analisis_abc(desde, hasta)     La regla 80/15/5 sobre lo VENDIDO del período:
--        A = las piezas que juntas aportan el 80 % del ingreso, B = hasta el 95 %, C = el resto.
--        Clasificar por INGRESO (valor) o por UNIDADES (movimiento) con p_por => 'VALOR' | 'UNIDADES'.
--   fn_rotacion_inventario(desde, hasta)  Cuánto rota cada pieza: unidades vendidas, días para
--        agotar el stock actual, valor parado en la gaveta y bandera «muerto» (sin ventas y con stock).
--   fn_rentabilidad_categoria(desde, hasta)  Ingreso, costo, utilidad y margen POR CATEGORÍA,
--        con las notas de crédito del período descontadas (igual criterio que el reporte 5A).
--   fn_rentabilidad_cliente(desde, hasta)   Cuánto compra cada cliente, su utilidad y margen,
--        su ticket promedio y hace cuánto no compra (los de menor margen y los dormidos salen solos).
--
--  Moneda: USD (base del sistema). El costo es el congelado en cada línea vendida: utilidad REAL.
-- =============================================================================
SET search_path = tienda, public;

-- ---------------------------------------------------------------------------
--  1. ANÁLISIS ABC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_analisis_abc(p_desde date, p_hasta date, p_por text DEFAULT 'VALOR')
RETURNS TABLE (clase char(1), producto_id bigint, sku varchar, nombre varchar, categoria varchar,
               unidades numeric, ingreso_usd numeric, costo_usd numeric, utilidad_usd numeric,
               margen_pct numeric, participacion_pct numeric, acumulado_pct numeric)
LANGUAGE plpgsql STABLE AS $$
DECLARE orden text := upper(COALESCE(p_por, 'VALOR'));
BEGIN
    IF orden NOT IN ('VALOR','UNIDADES') THEN
        RAISE EXCEPTION 'Clasifica por VALOR (ingreso) o UNIDADES, no por "%"', p_por USING ERRCODE = 'TV006';
    END IF;
    RETURN QUERY
    WITH ventas_prod AS (
        SELECT p.id, p.sku, p.nombre, COALESCE(c.nombre, 'Sin categoría') AS categoria,
               sum(d.cantidad) AS unidades,
               sum(d.base_usd) AS ingreso,
               sum(ROUND(d.cantidad * d.costo_unitario_usd, 2)) AS costo
          FROM detalle_venta d
          JOIN ventas v ON v.id = d.venta_id AND v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN p_desde AND p_hasta
          JOIN productos p ON p.id = d.producto_id
          LEFT JOIN categorias c ON c.id = p.categoria_id
         GROUP BY p.id, p.sku, p.nombre, c.nombre
    ), ordenado AS (
        SELECT vp.*,
               CASE WHEN orden = 'VALOR' THEN vp.ingreso ELSE vp.unidades END AS clave
          FROM ventas_prod vp
    ), ranqueado AS (
        SELECT o.*,
               row_number() OVER (ORDER BY o.clave DESC, o.nombre) AS rango,
               COALESCE(sum(o.clave) OVER (), 0) AS total_clave,
               sum(o.clave) OVER (ORDER BY o.clave DESC, o.nombre
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS acumulado
          FROM ordenado o
    )
    SELECT CASE WHEN r.acumulado / NULLIF(r.total_clave, 0) * 100 <= 80.0001 THEN 'A'::char(1)
                WHEN r.acumulado / NULLIF(r.total_clave, 0) * 100 <= 95.0001 THEN 'B'::char(1)
                ELSE 'C'::char(1) END,
           r.id, r.sku, r.nombre, r.categoria,
           r.unidades, ROUND(r.ingreso, 2), ROUND(r.costo, 2), ROUND(r.ingreso - r.costo, 2),
           CASE WHEN r.ingreso > 0 THEN ROUND((r.ingreso - r.costo) / r.ingreso * 100, 2) END,
           ROUND(r.clave / NULLIF(r.total_clave, 0) * 100, 2),
           ROUND(r.acumulado / NULLIF(r.total_clave, 0) * 100, 2)
      FROM ranqueado r
     ORDER BY r.rango;
END $$;
COMMENT ON FUNCTION fn_analisis_abc(date, date, text) IS 'Curva ABC de lo vendido en el período: A = 80 % del valor, B = hasta 95 %, C = el resto. Con p_por se clasifica por ingreso (VALOR) o por unidades.';

-- ---------------------------------------------------------------------------
--  2. ROTACIÓN Y DÍAS DE INVENTARIO
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_rotacion_inventario(p_desde date, p_hasta date)
RETURNS TABLE (producto_id bigint, sku varchar, nombre varchar, categoria varchar, marca varchar,
               stock_actual numeric, valor_stock_usd numeric, unidades_vendidas numeric,
               consumo_diario numeric, dias_para_agotar numeric, rotacion_veces numeric,
               dias_sin_venta int, con_minimo_definido boolean, estado_rotacion varchar(20))
LANGUAGE sql STABLE AS $$
    WITH ventas_prod AS (
        SELECT d.producto_id, sum(d.cantidad) AS vendido
          FROM detalle_venta d JOIN ventas v ON v.id = d.venta_id
         WHERE v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN p_desde AND p_hasta
         GROUP BY d.producto_id
    ), ultima_venta AS (
        SELECT d.producto_id, max(v.fecha_valor) AS ultima
          FROM detalle_venta d JOIN ventas v ON v.id = d.venta_id AND v.estado = 'COMPLETADA'
         GROUP BY d.producto_id
    )
    SELECT p.id, p.sku, p.nombre, c.nombre, m.nombre,
           p.stock_actual,
           ROUND(p.stock_actual * p.costo_usd, 2),
           COALESCE(vp.vendido, 0),
           COALESCE(vp.vendido, 0) / GREATEST((p_hasta - p_desde + 1), 1),
           CASE WHEN COALESCE(vp.vendido, 0) > 0 THEN p.stock_actual / (vp.vendido / GREATEST((p_hasta - p_desde + 1), 1)) END,
           CASE WHEN p.stock_actual > 0 AND COALESCE(vp.vendido, 0) > 0
                THEN ROUND(vp.vendido / p.stock_actual * 100, 1) END,
           CASE WHEN COALESCE(vp.vendido, 0) = 0 AND uv.ultima IS NOT NULL THEN (fn_hoy() - uv.ultima) END,
           p.stock_minimo > 0,
           CASE
             WHEN COALESCE(vp.vendido, 0) = 0 AND p.stock_actual <= 0 THEN 'SIN STOCK'
             WHEN COALESCE(vp.vendido, 0) = 0 THEN 'MUERTO (sin ventas)'::varchar
             WHEN p.stock_actual <= 0 THEN 'AGOTADO (venta perdida)'
             WHEN p.stock_actual / (vp.vendido / GREATEST((p_hasta - p_desde + 1), 1)) < 15 THEN 'ROTACIÓN RÁPIDA'
             WHEN p.stock_actual / (vp.vendido / GREATEST((p_hasta - p_desde + 1), 1)) > 90 THEN 'ROTACIÓN LENTA'
             ELSE 'NORMAL' END
      FROM productos p
      LEFT JOIN categorias c ON c.id = p.categoria_id
      LEFT JOIN marcas m ON m.id = p.marca_id
      LEFT JOIN ventas_prod vp ON vp.producto_id = p.id
      LEFT JOIN ultima_venta uv ON uv.producto_id = p.id
     WHERE p.activo
       AND (p.stock_actual > 0 OR COALESCE(vp.vendido, 0) > 0)
     ORDER BY 8 DESC NULLS LAST, 7 DESC, 3;
$$;
COMMENT ON FUNCTION fn_rotacion_inventario(date, date) IS 'Rotación por producto en el período: consumo diario, días para agotar el stock actual, valor parado a costo y bandera de pieza MUERTA (sin ventas y con stock).';

-- ---------------------------------------------------------------------------
--  3. RENTABILIDAD POR CATEGORÍA (descuenta notas de crédito del período)
-- ---------------------------------------------------------------------------
--  Mismo criterio que el reporte 5A (ReportesController::rentabilidad): la nota de crédito con productos
--  reparte su base en USD entre las piezas devueltas según su valor en la venta original, y ese ingreso
--  (y su costo) se descuenta de la categoría de cada pieza devuelta.
CREATE OR REPLACE FUNCTION fn_rentabilidad_categoria(p_desde date, p_hasta date)
RETURNS TABLE (categoria_id bigint, categoria text, unidades numeric, ingreso_usd numeric,
               costo_usd numeric, utilidad_usd numeric, margen_pct numeric, participacion_pct numeric)
LANGUAGE sql STABLE AS $$
    WITH linea AS (
        SELECT d.venta_id, d.producto_id, sum(d.cantidad) AS cant,
               sum(d.base_usd) AS ing, sum(ROUND(d.cantidad * d.costo_unitario_usd, 2)) AS cos
          FROM detalle_venta d GROUP BY d.venta_id, d.producto_id
    ), ventas_cat AS (
        SELECT COALESCE(p.categoria_id, 0) AS cat, COALESCE(c.nombre, 'Sin categoría') AS nombre,
               sum(d.cantidad) AS unidades, sum(d.base_usd) AS ingreso,
               sum(ROUND(d.cantidad * d.costo_unitario_usd, 2)) AS costo
          FROM detalle_venta d
          JOIN ventas v ON v.id = d.venta_id AND v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN p_desde AND p_hasta
          JOIN productos p ON p.id = d.producto_id
          LEFT JOIN categorias c ON c.id = p.categoria_id
         GROUP BY p.categoria_id, c.nombre
    ), notas AS (
        SELECT nd.nota_id, nd.producto_id, nd.cantidad, n.base_ves, v.tasa_cambio,
               nd.cantidad * l.ing / NULLIF(l.cant, 0) AS valor,
               nd.cantidad * l.cos / NULLIF(l.cant, 0) AS costo
          FROM notas_ajuste n
          JOIN notas_ajuste_detalle nd ON nd.nota_id = n.id AND n.tipo = 'C' AND n.fecha BETWEEN p_desde AND p_hasta
          JOIN ventas v ON v.id = n.venta_id AND v.estado = 'COMPLETADA'
          JOIN linea l ON l.venta_id = n.venta_id AND l.producto_id = nd.producto_id AND l.cant > 0
    ), notas_cat AS (
        SELECT s.cat, sum(s.ingreso_usd) AS ingreso, sum(s.costo) AS costo
          FROM (
            SELECT COALESCE(p.categoria_id, 0) AS cat,
                   (n.base_ves / NULLIF(n.tasa_cambio, 0)) * n.valor / NULLIF(sum(n.valor) OVER (PARTITION BY n.nota_id), 0) AS ingreso_usd,
                   n.costo
              FROM notas n JOIN productos p ON p.id = n.producto_id
          ) s
         GROUP BY s.cat
    ), total AS (
        SELECT sum(ingreso) AS ing FROM ventas_cat
    )
    SELECT vc.cat, vc.nombre, ROUND(vc.unidades, 3),
           ROUND(vc.ingreso - COALESCE(nc.ingreso, 0), 2),
           ROUND(vc.costo - COALESCE(nc.costo, 0), 2),
           ROUND((vc.ingreso - COALESCE(nc.ingreso, 0)) - (vc.costo - COALESCE(nc.costo, 0)), 2),
           CASE WHEN (vc.ingreso - COALESCE(nc.ingreso, 0)) > 0
                THEN ROUND(((vc.ingreso - COALESCE(nc.ingreso, 0)) - (vc.costo - COALESCE(nc.costo, 0)))
                            / (vc.ingreso - COALESCE(nc.ingreso, 0)) * 100, 2) END,
           ROUND((vc.ingreso - COALESCE(nc.ingreso, 0)) / NULLIF((SELECT ing FROM total), 0) * 100, 2)
      FROM ventas_cat vc
      LEFT JOIN notas_cat nc ON nc.cat = vc.cat
     ORDER BY 4 DESC, vc.nombre;
$$;
COMMENT ON FUNCTION fn_rentabilidad_categoria(date, date) IS 'Ingreso, costo, utilidad y margen por categoría del período; las notas de crédito con productos del período descontan la categoría correspondiente.';

-- ---------------------------------------------------------------------------
--  4. RENTABILIDAD POR CLIENTE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_rentabilidad_cliente(p_desde date, p_hasta date)
RETURNS TABLE (cliente_id bigint, cliente text, documento varchar, ventas int, unidades numeric,
               ingreso_usd numeric, costo_usd numeric, utilidad_usd numeric, margen_pct numeric,
               ticket_promedio_usd numeric, ultima_compra date, dias_sin_comprar int)
LANGUAGE sql STABLE AS $$
    WITH linea AS (
        SELECT d.venta_id, d.producto_id, sum(d.cantidad) AS cant,
               sum(d.base_usd) AS ing, sum(ROUND(d.cantidad * d.costo_unitario_usd, 2)) AS cos
          FROM detalle_venta d GROUP BY d.venta_id, d.producto_id
    ), base AS (
        SELECT COALESCE(v.cliente_id, 0) AS cliente_id, COALESCE(c.nombre, 'Consumidor final') AS nombre,
               CASE WHEN c.id IS NOT NULL THEN (c.tipo_documento || '-' || c.documento) ELSE NULL END AS doc,
               v.id AS venta_id, v.fecha_valor,
               sum(d.cantidad) AS unidades, sum(d.base_usd) AS ingreso,
               sum(ROUND(d.cantidad * d.costo_unitario_usd, 2)) AS costo
          FROM detalle_venta d
          JOIN ventas v ON v.id = d.venta_id AND v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN p_desde AND p_hasta
          LEFT JOIN clientes c ON c.id = v.cliente_id
         GROUP BY COALESCE(v.cliente_id, 0), COALESCE(c.nombre, 'Consumidor final'),
                  CASE WHEN c.id IS NOT NULL THEN (c.tipo_documento || '-' || c.documento) ELSE NULL END, v.id, v.fecha_valor
    ), notas AS (
        SELECT n.venta_id, nd.nota_id, nd.producto_id, nd.cantidad, n.base_ves, v.tasa_cambio,
               nd.cantidad * l.ing / NULLIF(l.cant, 0) AS valor,
               nd.cantidad * l.cos / NULLIF(l.cant, 0) AS costo
          FROM notas_ajuste n
          JOIN notas_ajuste_detalle nd ON nd.nota_id = n.id AND n.tipo = 'C' AND n.fecha BETWEEN p_desde AND p_hasta
          JOIN ventas v ON v.id = n.venta_id AND v.estado = 'COMPLETADA'
          JOIN linea l ON l.venta_id = n.venta_id AND l.producto_id = nd.producto_id AND l.cant > 0
    ), notas_cli AS (
        -- Notas de crédito CON productos: su base (en USD) y su costo se reparten entre las piezas devueltas.
        SELECT s.cliente_id, sum(s.ingreso_usd) AS ingreso, sum(s.costo) AS costo
          FROM (
            SELECT COALESCE(v.cliente_id, 0) AS cliente_id,
                   (n.base_ves / NULLIF(n.tasa_cambio, 0)) * n.valor / NULLIF(sum(n.valor) OVER (PARTITION BY n.nota_id), 0) AS ingreso_usd,
                   n.costo
              FROM notas n
              JOIN ventas v ON v.id = n.venta_id
          ) s
         GROUP BY s.cliente_id
    ), notas_sin_prod AS (
        -- Notas SIN productos (descuentos y ajustes): créditos restan, débitos suman. Solo ingreso.
        SELECT COALESCE(v.cliente_id, 0) AS cliente_id,
               sum(CASE WHEN n.tipo = 'C' THEN -1 ELSE 1 END * n.base_ves / NULLIF(v.tasa_cambio, 0)) AS ingreso
          FROM notas_ajuste n JOIN ventas v ON v.id = n.venta_id AND v.estado = 'COMPLETADA'
         WHERE n.fecha BETWEEN p_desde AND p_hasta
           AND NOT EXISTS (SELECT 1 FROM notas_ajuste_detalle nd WHERE nd.nota_id = n.id)
         GROUP BY COALESCE(v.cliente_id, 0)
    )
    SELECT b.cliente_id, b.nombre, b.doc,
           count(DISTINCT b.venta_id), ROUND(sum(b.unidades), 3),
           ROUND(sum(b.ingreso) + COALESCE(ns.ingreso, 0) - COALESCE(nc.ingreso, 0), 2),
           ROUND(sum(b.costo) - COALESCE(nc.costo, 0), 2),
           ROUND((sum(b.ingreso) + COALESCE(ns.ingreso, 0) - COALESCE(nc.ingreso, 0)) - (sum(b.costo) - COALESCE(nc.costo, 0)), 2),
           CASE WHEN sum(b.ingreso) > 0 THEN ROUND(((sum(b.ingreso) + COALESCE(ns.ingreso, 0) - COALESCE(nc.ingreso, 0)) - (sum(b.costo) - COALESCE(nc.costo, 0))) / sum(b.ingreso) * 100, 2) END,
           ROUND((sum(b.ingreso) + COALESCE(ns.ingreso, 0) - COALESCE(nc.ingreso, 0)) / NULLIF(count(DISTINCT b.venta_id), 0), 2),
           max(b.fecha_valor),
           fn_hoy() - max(b.fecha_valor)
      FROM base b
      LEFT JOIN notas_sin_prod ns ON ns.cliente_id = b.cliente_id
      LEFT JOIN notas_cli nc ON nc.cliente_id = b.cliente_id
     GROUP BY b.cliente_id, b.nombre, b.doc, ns.ingreso, nc.ingreso, nc.costo
     ORDER BY 6 DESC NULLS LAST, b.nombre;
$$;
COMMENT ON FUNCTION fn_rentabilidad_cliente(date, date) IS 'Ventas, ingreso, utilidad, margen, ticket promedio y días sin comprar de cada cliente. Las notas sin producto (descuentos) restan al ingreso del cliente.';
