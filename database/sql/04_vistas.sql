-- =============================================================================
--  Archivo 04 · VISTAS (consultas listas para pantallas y reportes)
-- =============================================================================
--  Las vistas solo LEEN. Los montos en Bs de los precios del catálogo se calculan aquí con la tasa
--  más reciente (nunca se guardan). Los documentos ya emitidos (ventas/compras) usan su propia tasa congelada.
-- =============================================================================
SET search_path = tienda, public;

-- Tasa USD→VES que aplica HOY según la regla del negocio (la misma que fn_tasa_aplicable, pero sin lanzar error): la de hoy si
-- existe; si no, con SIGUIENTE la próxima ya publicada, y si no hay, la última anterior. dias_antiguedad = hoy − fecha_valor
-- (negativo si la tasa es del próximo día hábil). «vigente» = |dias_antiguedad| ≤ dias_max_tasa_antigua. Una fila (o ninguna).
CREATE OR REPLACE VIEW v_tasa_actual AS
SELECT t.tasa, t.fecha_valor, t.fuente, t.es_oficial_bcv, t.obtenida_en,
       (fn_hoy() - t.fecha_valor) AS dias_antiguedad,
       (abs(fn_hoy() - t.fecha_valor) <= n.dias_max_tasa_antigua) AS vigente
  FROM tasas_cambio t CROSS JOIN negocio n
 WHERE t.moneda_origen = 'USD' AND t.moneda_destino = 'VES'
   AND (t.fecha_valor <= fn_hoy() OR n.regla_tasa_sin_publicacion = 'SIGUIENTE')
 ORDER BY CASE WHEN t.fecha_valor = fn_hoy() THEN 0 WHEN t.fecha_valor > fn_hoy() THEN 1 ELSE 2 END,
          CASE WHEN t.fecha_valor > fn_hoy() THEN t.fecha_valor END ASC NULLS LAST,
          t.fecha_valor DESC
 LIMIT 1;
COMMENT ON VIEW v_tasa_actual IS 'Tasa USD→VES que aplica hoy según negocio.regla_tasa_sin_publicacion (igual que fn_tasa_aplicable, sin lanzar error) y bandera «vigente». La caja la usa para avisar si hay que actualizarla.';

CREATE OR REPLACE VIEW v_tasas_actuales AS
SELECT DISTINCT ON (t.moneda_origen, t.moneda_destino)
       t.moneda_origen, t.moneda_destino, t.tasa, t.fecha_valor, t.fuente, t.es_oficial_bcv,
       (fn_hoy() - t.fecha_valor) AS dias_antiguedad,
       (abs(fn_hoy() - t.fecha_valor) <= COALESCE(n.dias_max_tasa_antigua, 4)) AS vigente
  FROM tasas_cambio t CROSS JOIN negocio n
 WHERE t.fecha_valor <= fn_hoy()
 ORDER BY t.moneda_origen, t.moneda_destino, t.fecha_valor DESC;
COMMENT ON VIEW v_tasas_actuales IS 'Última tasa cargada de cada par (USD/VES, EUR/VES, COP/VES...), con su antigüedad y la bandera «vigente» (dentro de negocio.dias_max_tasa_antigua). Listado completo: no filtra por par.';

-- Catálogo con costo, margen y precios (USD y Bs). precio_final_* incluye IVA si el producto lo causa.
CREATE OR REPLACE VIEW v_productos_precios AS
SELECT p.id, p.sku, p.codigo_barras, p.referencia_fabricante, p.nombre, c.nombre AS categoria, m.nombre AS marca,
       p.unidad, p.ubicacion_almacen, p.stock_actual, p.stock_minimo, p.exento_iva, p.exonerado_iva, p.activo,
       p.costo_usd,
       fn_margen_para(p.margen_pct, p.categoria_id) AS margen_pct,
       p.margen_pct IS NULL AS margen_heredado,
       p.precio_venta_usd,
       ROUND(p.precio_venta_usd * ta.tasa, 2) AS precio_venta_ves,
       CASE WHEN p.exento_iva OR p.exonerado_iva OR n.precios_incluyen_iva THEN p.precio_venta_usd
            ELSE ROUND(p.precio_venta_usd * (1 + iva.porcentaje / 100), 2) END AS precio_final_usd,
       CASE WHEN p.exento_iva OR p.exonerado_iva OR n.precios_incluyen_iva THEN ROUND(p.precio_venta_usd * ta.tasa, 2)
            ELSE ROUND(p.precio_venta_usd * ta.tasa * (1 + iva.porcentaje / 100), 2) END AS precio_final_ves,
       ta.tasa AS tasa_usada, ta.fecha_valor AS tasa_fecha_valor
  FROM productos p
  CROSS JOIN negocio n
  LEFT JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN marcas m ON m.id = p.marca_id
  LEFT JOIN v_tasa_actual ta ON TRUE
  LEFT JOIN LATERAL (SELECT porcentaje FROM parametros_fiscales
                      WHERE codigo = 'IVA_GENERAL' AND vigente_desde <= fn_hoy() AND (vigente_hasta IS NULL OR vigente_hasta >= fn_hoy())
                      LIMIT 1) iva ON TRUE;
COMMENT ON VIEW v_productos_precios IS 'Catálogo de venta: costo, margen efectivo, precio en USD y en Bs (calculado con la tasa más reciente).';

CREATE OR REPLACE VIEW v_stock_bajo AS
SELECT id, sku, nombre, stock_actual, stock_minimo, (stock_minimo - stock_actual) AS faltante
  FROM productos WHERE activo AND stock_actual <= stock_minimo ORDER BY (stock_minimo - stock_actual) DESC;
COMMENT ON VIEW v_stock_bajo IS 'Productos activos en o bajo su stock mínimo (para reponer).';

CREATE OR REPLACE VIEW v_valor_inventario AS
SELECT p.id, p.sku, p.nombre, p.stock_actual, p.costo_usd, p.precio_venta_usd,
       ROUND(p.stock_actual * p.costo_usd, 2) AS valor_costo_usd,
       ROUND(p.stock_actual * p.precio_venta_usd, 2) AS valor_venta_usd
  FROM productos p WHERE p.activo AND p.stock_actual > 0;
COMMENT ON VIEW v_valor_inventario IS 'Valor del inventario a costo y a precio de venta, por producto (sume para el total).';

-- Alertas de cambio de costo pendientes de confirmar (política AVISAR).
CREATE OR REPLACE VIEW v_alertas_precio_pendientes AS
SELECT a.id AS alerta_id, a.creada_en, p.id AS producto_id, p.sku, p.nombre,
       p.costo_usd AS costo_actual_usd, a.margen_pct, a.precio_actual_usd, a.precio_sugerido_usd,
       (a.precio_sugerido_usd - a.precio_actual_usd) AS diferencia_usd,
       CASE WHEN a.precio_actual_usd > 0 THEN ROUND((a.precio_sugerido_usd - a.precio_actual_usd) / a.precio_actual_usd * 100, 2) END AS variacion_pct
  FROM alertas_precio a JOIN productos p ON p.id = a.producto_id
 WHERE a.estado = 'PENDIENTE' ORDER BY a.creada_en;
COMMENT ON VIEW v_alertas_precio_pendientes IS 'Precios por confirmar tras llegar mercancía con costo nuevo. Se resuelven con sp_resolver_alerta_precio.';

CREATE OR REPLACE VIEW v_kardex AS
SELECT mi.id, mi.fecha, p.sku, p.nombre, mi.tipo, mi.cantidad, mi.stock_resultante,
       mi.referencia_tipo, mi.referencia_id, mi.motivo, mi.usuario_id, mi.producto_id
  FROM movimientos_inventario mi JOIN productos p ON p.id = mi.producto_id;
COMMENT ON VIEW v_kardex IS 'Kardex legible: cada entrada/salida con el stock que dejó. Filtre por producto_id.';

CREATE OR REPLACE VIEW v_compatibilidad AS
SELECT pc.producto_id, p.sku, p.nombre AS producto, mm.marca, mm.modelo, mm.cilindrada, pc.anio_desde, pc.anio_hasta
  FROM producto_compatibilidad pc JOIN productos p ON p.id = pc.producto_id JOIN motos_modelos mm ON mm.id = pc.moto_modelo_id;
COMMENT ON VIEW v_compatibilidad IS 'Qué repuesto sirve para qué moto (búsqueda «para mi Bera SBR»).';

-- Listado de ventas con cliente y formas de pago.
CREATE OR REPLACE VIEW v_ventas_resumen AS
SELECT v.id, v.numero, v.numero_factura_fiscal, v.fecha_hora, v.fecha_valor, v.estado,
       COALESCE(c.nombre, 'Consumidor final') AS cliente, c.tipo_documento || '-' || c.documento AS documento_cliente,
       v.tasa_cambio, v.base_usd, v.exento_usd, v.iva_usd, v.total_usd, v.igtf_usd, v.total_cobrar_usd,
       v.base_ves, v.exento_ves, v.iva_ves, v.total_ves, v.igtf_ves, v.total_cobrar_ves,
       (SELECT string_agg(mp.nombre || ' ' || pv.monto || ' ' || pv.moneda, ' + ' ORDER BY pv.id)
          FROM pagos_venta pv JOIN metodos_pago mp ON mp.id = pv.metodo_pago_id WHERE pv.venta_id = v.id) AS pagos,
       v.usuario_id
  FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id;
COMMENT ON VIEW v_ventas_resumen IS 'Una fila por venta: totales USD/Bs, IGTF y resumen de pagos.';

-- Libro de ventas (formato fiscal): una fila por factura y una por cada nota de crédito/débito, en Bs.
-- Discrimina base gravada (alícuota general), exento y exonerado desde las líneas. Las notas de crédito restan.
-- NO incluye columnas de alícuota reducida ni de «no sujeto»: el sistema aún no maneja esos casos (ver README).
CREATE OR REPLACE VIEW v_libro_ventas AS
SELECT v.fecha_valor AS fecha, 'FACTURA'::text AS tipo_documento, v.numero::text AS numero,
       v.numero_factura_fiscal, v.numero_control, v.tipo_emision, NULL::text AS documento_afectado,
       COALESCE(c.nombre, 'Consumidor final') AS cliente, c.tipo_documento || '-' || c.documento AS rif_cedula,
       v.estado, v.iva_pct, v.tasa_cambio,
       COALESCE(l.base_general_ves, 0) AS base_imponible_ves,
       COALESCE(l.exento_ves, 0)       AS exento_ves,
       COALESCE(l.exonerado_ves, 0)    AS exonerado_ves,
       v.iva_ves, v.total_ves, v.igtf_ves,
       COALESCE((SELECT string_agg(DISTINCT pv.moneda, ',' ORDER BY pv.moneda)
                   FROM pagos_venta pv WHERE pv.venta_id = v.id), 'USD') AS monedas_pago
  FROM ventas v
  LEFT JOIN clientes c ON c.id = v.cliente_id
  LEFT JOIN LATERAL (SELECT sum(d.base_ves) FILTER (WHERE d.alicuota_codigo = 'IVA_GENERAL') AS base_general_ves,
                            sum(d.base_ves) FILTER (WHERE d.alicuota_codigo = 'EXENTO')      AS exento_ves,
                            sum(d.base_ves) FILTER (WHERE d.alicuota_codigo = 'EXONERADO')   AS exonerado_ves
                       FROM detalle_venta d WHERE d.venta_id = v.id) l ON TRUE
UNION ALL
SELECT n.fecha, CASE n.tipo WHEN 'C' THEN 'NOTA_CREDITO' ELSE 'NOTA_DEBITO' END, n.numero,
       NULL, n.numero_control, v.tipo_emision, COALESCE(v.numero_factura_fiscal, v.numero::text),
       COALESCE(c.nombre, 'Consumidor final'), c.tipo_documento || '-' || c.documento,
       'REGISTRADA', n.iva_pct, v.tasa_cambio,
       CASE n.tipo WHEN 'C' THEN -n.base_ves ELSE n.base_ves END, 0, 0,
       CASE n.tipo WHEN 'C' THEN -n.iva_ves ELSE n.iva_ves END,
       CASE n.tipo WHEN 'C' THEN -n.total_ves ELSE n.total_ves END, 0,
       COALESCE((SELECT string_agg(DISTINCT pv.moneda, ',' ORDER BY pv.moneda)
                   FROM pagos_venta pv WHERE pv.venta_id = v.id), 'USD')
  FROM notas_ajuste n JOIN ventas v ON v.id = n.venta_id LEFT JOIN clientes c ON c.id = v.cliente_id;
COMMENT ON VIEW v_libro_ventas IS 'Base del libro de ventas en Bs (tasa de cada operación): facturas y notas de crédito/débito (las de crédito en negativo). Las facturas ANULADAS aparecen con estado ANULADA: no las sume. `monedas_pago` lista las monedas usadas en los pagos de esa venta (USD, VES, EUR, COP...), separadas por coma.';

-- Libro de compras en Bs. Facturas en VES: montos tal cual. Facturas en USD: se convierten con la última tasa
-- publicada hasta la fecha de la factura (si no hay ninguna, quedan en NULL en lugar de inventar un valor).
CREATE OR REPLACE VIEW v_libro_compras AS
SELECT c.fecha_factura AS fecha, c.id AS compra_id, pr.rif AS rif_proveedor, pr.razon_social AS proveedor,
       c.numero_factura, c.numero_control, c.estado, c.moneda, c.aplica_credito_fiscal,
       ROUND(c.base_imponible * f.tasa, 2) AS base_imponible_ves,
       ROUND(c.base_exenta * f.tasa, 2)    AS exento_ves,
       ROUND(c.monto_iva * f.tasa, 2)      AS iva_ves,
       CASE WHEN c.aplica_credito_fiscal THEN ROUND(c.monto_iva * f.tasa, 2) ELSE 0 END AS credito_fiscal_ves,
       ROUND(c.total * f.tasa, 2)          AS total_ves
  FROM compras c
  JOIN proveedores pr ON pr.id = c.proveedor_id
  CROSS JOIN LATERAL (
        SELECT CASE WHEN c.moneda = 'VES' THEN 1::numeric
                    ELSE (SELECT t.tasa FROM tasas_cambio t
                           WHERE t.moneda_origen = 'USD' AND t.moneda_destino = 'VES' AND t.fecha_valor <= c.fecha_factura
                           ORDER BY t.fecha_valor DESC LIMIT 1) END AS tasa) f;
COMMENT ON VIEW v_libro_compras IS 'Base del libro de compras y del crédito fiscal en Bs. Las anuladas aparecen con estado ANULADA: no las sume.';

-- Ventas por día (solo completadas): lo que se cierra al final de la jornada.
CREATE OR REPLACE VIEW v_ventas_diarias AS
SELECT fecha_valor AS fecha, count(*) AS cantidad_ventas,
       sum(base_usd + exento_usd) AS ventas_sin_iva_usd, sum(iva_usd) AS iva_usd, sum(total_usd) AS total_usd, sum(igtf_usd) AS igtf_usd,
       sum(base_ves + exento_ves) AS ventas_sin_iva_ves, sum(iva_ves) AS iva_ves, sum(total_ves) AS total_ves, sum(igtf_ves) AS igtf_ves
  FROM ventas WHERE estado = 'COMPLETADA' GROUP BY fecha_valor ORDER BY fecha_valor DESC;
COMMENT ON VIEW v_ventas_diarias IS 'Totales por día (ventas completadas), en USD y en Bs con la tasa de cada venta.';

-- Cierre de caja: cuánto entró por cada método de pago.
CREATE OR REPLACE VIEW v_cierre_caja AS
SELECT v.fecha_valor AS fecha, mp.nombre AS metodo_pago, pv.moneda, count(*) AS cantidad_pagos,
       sum(pv.monto) AS monto_aplicado, sum(pv.igtf_monto) AS igtf, sum(pv.monto_cobrado) AS total_cobrado,
       sum(pv.monto_usd) AS equivalente_usd, sum(pv.monto_ves) AS equivalente_ves
  FROM pagos_venta pv JOIN ventas v ON v.id = pv.venta_id JOIN metodos_pago mp ON mp.id = pv.metodo_pago_id
 WHERE v.estado = 'COMPLETADA' GROUP BY v.fecha_valor, mp.nombre, pv.moneda ORDER BY v.fecha_valor DESC, mp.nombre;
COMMENT ON VIEW v_cierre_caja IS 'Por día y método de pago: lo cobrado (incluye IGTF) para cuadrar caja.';

-- Utilidad real por día: ingreso sin IVA menos el costo congelado en cada línea.
CREATE OR REPLACE VIEW v_utilidad_diaria AS
SELECT v.fecha_valor AS fecha, sum(d.base_usd) AS ingreso_usd,
       sum(ROUND(d.cantidad * d.costo_unitario_usd, 2)) AS costo_usd,
       sum(d.base_usd) - sum(ROUND(d.cantidad * d.costo_unitario_usd, 2)) AS utilidad_usd,
       CASE WHEN sum(d.base_usd) > 0 THEN ROUND((sum(d.base_usd) - sum(ROUND(d.cantidad * d.costo_unitario_usd, 2))) / sum(d.base_usd) * 100, 2) END AS margen_sobre_venta_pct
  FROM detalle_venta d JOIN ventas v ON v.id = d.venta_id
 WHERE v.estado = 'COMPLETADA' GROUP BY v.fecha_valor ORDER BY v.fecha_valor DESC;
COMMENT ON VIEW v_utilidad_diaria IS 'Ingreso (sin IVA), costo y utilidad en USD por día. Con precios que incluyen IVA el ingreso ya excluye el IVA.';

CREATE OR REPLACE VIEW v_productos_mas_vendidos AS
SELECT p.id AS producto_id, p.sku, p.nombre, sum(d.cantidad) AS unidades, sum(d.base_usd) AS ingreso_usd,
       sum(d.base_usd) - sum(ROUND(d.cantidad * d.costo_unitario_usd, 2)) AS utilidad_usd
  FROM detalle_venta d JOIN ventas v ON v.id = d.venta_id AND v.estado = 'COMPLETADA' JOIN productos p ON p.id = d.producto_id
 GROUP BY p.id, p.sku, p.nombre ORDER BY unidades DESC;
COMMENT ON VIEW v_productos_mas_vendidos IS 'Ranking histórico de productos por unidades vendidas.';

-- IGTF cobrado por día (para declararlo/enterarlo).
CREATE OR REPLACE VIEW v_igtf_diario AS
SELECT v.fecha_valor AS fecha, sum(pv.monto_usd) FILTER (WHERE pv.aplica_igtf) AS base_divisas_usd,
       sum(pv.igtf_usd) AS igtf_usd, sum(pv.igtf_ves) AS igtf_ves
  FROM pagos_venta pv JOIN ventas v ON v.id = pv.venta_id
 WHERE v.estado = 'COMPLETADA' GROUP BY v.fecha_valor HAVING sum(pv.igtf_usd) > 0 ORDER BY v.fecha_valor DESC;
COMMENT ON VIEW v_igtf_diario IS 'IGTF de ventas COMPLETADAS por día (solo pagos en divisas), BRUTO: las ventas anuladas desaparecen de su día original. Contrato histórico, no use esta vista para declarar: para lo cobrado incluyendo anuladas ver v_igtf_a_declarar.';

-- IGTF neto por día: lo cobrado ese día (incluyendo ventas que luego se anularon) menos las reversiones registradas ese día.
-- OJO: no se calcula como v_igtf_diario − reversiones porque v_igtf_diario ya excluye las ventas anuladas (se restaría dos veces).
-- Una venta cobrada el lunes y anulada el miércoles suma en el lunes y resta en el miércoles.
CREATE OR REPLACE VIEW v_igtf_neto_diario AS
WITH cobrado AS (
    SELECT v.fecha_valor AS fecha, sum(pv.igtf_usd) AS usd, sum(pv.igtf_ves) AS ves
      FROM pagos_venta pv JOIN ventas v ON v.id = pv.venta_id GROUP BY v.fecha_valor
), revertido AS (
    SELECT fecha, sum(igtf_usd) AS usd, sum(igtf_ves) AS ves FROM reversiones_igtf GROUP BY fecha
)
SELECT COALESCE(c.fecha, r.fecha)                          AS fecha,
       COALESCE(c.usd, 0)                                  AS igtf_cobrado_usd,
       COALESCE(r.usd, 0)                                  AS igtf_revertido_usd,
       COALESCE(c.usd, 0) - COALESCE(r.usd, 0)             AS igtf_neto_usd,
       COALESCE(c.ves, 0)                                  AS igtf_cobrado_ves,
       COALESCE(r.ves, 0)                                  AS igtf_revertido_ves,
       COALESCE(c.ves, 0) - COALESCE(r.ves, 0)             AS igtf_neto_ves,
       (SELECT reversa_igtf_en_anulacion FROM negocio WHERE id = fn_negocio_actual()) AS politica_reversa_igtf
  FROM cobrado c FULL JOIN revertido r ON r.fecha = c.fecha
 WHERE COALESCE(c.usd, 0) <> 0 OR COALESCE(r.usd, 0) <> 0
 ORDER BY 1 DESC;
COMMENT ON VIEW v_igtf_neto_diario IS 'IGTF por día: cobrado (incluye ventas luego anuladas), revertido (reversiones_igtf del día) y neto, en USD y Bs. politica_reversa_igtf muestra el valor actual de negocio.reversa_igtf_en_anulacion (si es FALSE no se registran reversiones y el IGTF de ventas anuladas queda en el neto). Informativa: según las fuentes consultadas el IGTF cobrado no se resta al declarar (ver v_igtf_a_declarar); lo revertido es lo que se reclama al SENIAT. Pendiente de confirmar con el contador.';

-- IGTF A DECLARAR por día de pago: lo efectivamente COBRADO en divisas, incluyendo ventas luego anuladas. Según las fuentes consultadas
-- (secundarias: Gálac, Moore, Nayma, Gerencia y Tributos) el IGTF se causa al momento del pago y pertenece al Fisco; anular la venta no
-- lo extingue: el agente declara lo percibido y el reintegro al cliente se reclama después ante el SENIAT (art. 4 PA SNAT/2022/000013;
-- COT arts. 205-210). Por eso las anuladas NO se restan aquí; se muestran aparte como «reintegros por reclamar».
CREATE OR REPLACE VIEW v_igtf_a_declarar AS
SELECT v.fecha_valor AS fecha,
       sum(pv.monto_usd) FILTER (WHERE pv.aplica_igtf)                                   AS base_divisas_usd,
       sum(pv.igtf_usd)                                                                  AS igtf_usd,
       sum(pv.igtf_ves)                                                                  AS igtf_ves,
       COALESCE(sum(pv.igtf_usd) FILTER (WHERE v.estado = 'ANULADA'), 0)                 AS igtf_de_ventas_anuladas_usd,
       COALESCE(sum(pv.igtf_ves) FILTER (WHERE v.estado = 'ANULADA'), 0)                 AS igtf_de_ventas_anuladas_ves
  FROM pagos_venta pv JOIN ventas v ON v.id = pv.venta_id
 GROUP BY v.fecha_valor HAVING sum(pv.igtf_usd) > 0 ORDER BY v.fecha_valor DESC;
COMMENT ON VIEW v_igtf_a_declarar IS 'IGTF a declarar por día de la venta (fecha_valor): TODO lo cobrado en divisas, incluso de ventas luego anuladas, en USD y Bs (a la tasa congelada del pago). igtf_de_ventas_anuladas_* es la parte que, si se devolvió al cliente, se reclama al SENIAT (no se resta aquí). Basado en fuentes secundarias; confirmar con el contador antes de declarar.';

-- Crédito fiscal de IVA por mes (para la declaración de IVA): lo recuperable y lo que pasó al costo.
CREATE OR REPLACE VIEW v_credito_fiscal_mensual AS
SELECT date_trunc('month', fecha)::date AS periodo,
       sum(credito_fiscal_ves)           AS credito_fiscal_ves,
       sum(iva_ves - credito_fiscal_ves) AS iva_llevado_al_costo_ves,
       count(*)                          AS facturas
  FROM v_libro_compras WHERE estado = 'REGISTRADA'
 GROUP BY 1 ORDER BY 1 DESC;
COMMENT ON VIEW v_credito_fiscal_mensual IS 'IVA de compras por mes: parte recuperable como crédito fiscal y parte que pasó al costo (facturas sin crédito). Excluye compras anuladas.';

-- Números de venta que faltan entre el primero y el último. Un hueco NO es una venta borrada: las ventas no se pueden borrar
-- (trigger de inmutabilidad); el número sale de una secuencia de PostgreSQL que no se devuelve si la transacción se revierte
-- (p. ej. venta rechazada por stock insuficiente, por pagos que no cuadran, o por un corte a mitad de la operación).
CREATE OR REPLACE VIEW v_ventas_huecos AS
WITH rango AS (SELECT min(numero) AS desde, max(numero) AS hasta FROM ventas)
SELECT g.n                                                              AS numero_faltante,
       (SELECT max(v.numero) FROM ventas v WHERE v.numero < g.n)        AS numero_anterior,
       (SELECT min(v.numero) FROM ventas v WHERE v.numero > g.n)        AS numero_siguiente,
       (SELECT v.fecha_hora FROM ventas v WHERE v.numero = (SELECT min(v2.numero) FROM ventas v2 WHERE v2.numero > g.n)) AS fecha_hora_siguiente
  FROM rango r, generate_series(r.desde, r.hasta) AS g(n)
 WHERE NOT EXISTS (SELECT 1 FROM ventas v WHERE v.numero = g.n)
 ORDER BY g.n;
COMMENT ON VIEW v_ventas_huecos IS 'Números de venta faltantes entre el mínimo y el máximo, con el número anterior/siguiente existente. Son reversiones de transacciones fallidas (la secuencia no se devuelve), no ventas borradas: las ventas son inmutables. El número fiscal es otro campo (numero_factura_fiscal).';
