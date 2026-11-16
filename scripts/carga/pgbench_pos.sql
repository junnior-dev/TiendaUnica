-- Workload real de POS (Tienda Única Repuestos de Motos) para pgbench
-- Uso:
--   pgbench -h 127.0.0.1 -p 5432 -U admin -c 50 -j 8 -T 15 -P 5 -f scripts/carga/pgbench_pos.sql tienda_pgbench

\set pid random(1, 8)

BEGIN;

-- 1. Búsqueda de catálogo y compatibilidad de motos
SELECT id, sku, nombre, precio_venta_usd, stock_actual
  FROM tienda.v_productos_precios
 WHERE activo AND id = :pid;

-- 2. Cotización y registro de venta real en una transacción
WITH cot AS (
    SELECT total_ves
      FROM tienda.fn_cotizar_venta(
               jsonb_build_array(jsonb_build_object('producto_id', :pid, 'cantidad', 1, 'descuento_pct', 0))
           )
)
SELECT tienda.fn_registrar_venta(
           1,
           jsonb_build_array(jsonb_build_object('producto_id', :pid, 'cantidad', 1, 'descuento_pct', 0)),
           jsonb_build_array(jsonb_build_object('metodo_pago_id', 4, 'monto', total_ves, 'referencia', 'PGBENCH')),
           NULL,
           'Carga pgbench',
           'PRESENCIAL',
           FALSE,
           0
       )
  FROM cot;

COMMIT;
