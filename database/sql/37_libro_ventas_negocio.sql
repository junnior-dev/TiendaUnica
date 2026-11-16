-- =============================================================================
--  37 · v_libro_ventas con id_negocio (multiinquilino)
-- =============================================================================
--  La vista nació en 04 (antes de existir negocio_id) y se aislaba solo por RLS: un superusuario veía TODAS las tiendas mezcladas.
--  Aquí se agrega id_negocio AL FINAL de la lista (CREATE OR REPLACE solo permite añadir columnas al final) para que cualquier
--  consulta pueda filtrar explícitamente: WHERE id_negocio = fn_negocio_actual(). Va después de 31. Es idempotente.
-- =============================================================================
SET search_path = tienda, public;

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
                   FROM pagos_venta pv WHERE pv.venta_id = v.id), 'USD') AS monedas_pago,
       v.negocio_id AS id_negocio
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
                   FROM pagos_venta pv WHERE pv.venta_id = v.id), 'USD'),
       n.negocio_id
  FROM notas_ajuste n JOIN ventas v ON v.id = n.venta_id LEFT JOIN clientes c ON c.id = v.cliente_id;
ALTER VIEW v_libro_ventas SET (security_invoker = true);
COMMENT ON VIEW v_libro_ventas IS 'Base del libro de ventas en Bs (tasa de cada operación): facturas y notas de crédito/débito (las de crédito en negativo). Las facturas ANULADAS aparecen con estado ANULADA: no las sume. `monedas_pago` lista las monedas usadas en los pagos de esa venta. `id_negocio` permite filtrar por tienda además del RLS.';
