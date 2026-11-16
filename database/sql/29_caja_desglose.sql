-- =============================================================================
--  29 · DESGLOSE DEL CORTE DE CAJA (X, Z y cierre del día)
-- =============================================================================
--  Requiere: 01..24 (encargos). Es idempotente:
--     psql -d tienda -v ON_ERROR_STOP=1 -f 29_caja_desglose.sql
--
--  Complementa el informe de cierre (CierreCajaController) y el Corte X/Z (fn_resumen_apertura del 16/24)
--  con lo que faltaba para DIRIGIR la caja, no solo cuadrarla:
--
--     · ventas por hora del día (cuándo entra el dinero: ¿la tarde o la mañana?).
--     · top de piezas vendidas del período (unidades, ingreso y utilidad).
--     · crédito del día: cuentas por cobrar creadas y cobros recibidos.
--     · anticipos de encargos: cobrados hoy (entraron a la gaveta) y aplicados hoy en entregas.
--     · ingresos/egresos de caja por origen (encargo, nota de crédito, cobro, manual).
--     · correlativo del corte: cuántos cierres lleva la caja ese día (para etiquetar el X/Z).
--
--  Es una sola función JSON: fn_corte_desglose(desde, hasta, usuario).
--    usuario = 0 → todas las cajas del período; > 0 → solo las ventas de ese cajero.
-- =============================================================================
SET search_path = tienda, public;

CREATE OR REPLACE FUNCTION fn_corte_desglose(p_desde date, p_hasta date, p_usuario_id bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
    w varchar := CASE WHEN COALESCE(p_usuario_id, 0) > 0 THEN ' AND v.usuario_id = ' || p_usuario_id::text ELSE '' END;
    horas jsonb; tops jsonb; credito jsonb; anticipos jsonb; movs jsonb; correlativo int; res record;
BEGIN
    -- a) ventas por hora (0..23) del período, solo completadas
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'hora', x.hora, 'ventas', x.n, 'total_usd', x.usd, 'total_ves', x.ves)
                ORDER BY x.hora), '[]'::jsonb) INTO horas
      FROM (SELECT EXTRACT(HOUR FROM v.fecha_hora AT TIME ZONE 'America/Caracas')::int AS hora,
                   count(*) AS n,
                   COALESCE(sum(pv.monto_usd + pv.igtf_usd), 0) AS usd,
                   COALESCE(sum(pv.monto_ves + pv.igtf_ves), 0) AS ves
              FROM ventas v JOIN pagos_venta pv ON pv.venta_id = v.id
             WHERE v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN p_desde AND p_hasta
             GROUP BY 1) x;

    -- b) top de piezas (máximo 12 por unidades) con su utilidad real (costo congelado)
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'sku', x.sku, 'nombre', x.nombre, 'unidades', x.un, 'ingreso_usd', x.ing, 'utilidad_usd', x.ut)
                ORDER BY x.un DESC, x.ing DESC), '[]'::jsonb) INTO tops
      FROM (SELECT p.sku, p.nombre, sum(d.cantidad) AS un,
                   sum(d.base_usd) AS ing,
                   sum(d.base_usd) - sum(ROUND(d.cantidad * d.costo_unitario_usd, 2)) AS ut
              FROM detalle_venta d JOIN ventas v ON v.id = d.venta_id JOIN productos p ON p.id = d.producto_id
             WHERE v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN p_desde AND p_hasta
             GROUP BY p.id, p.sku, p.nombre
             ORDER BY un DESC, ing DESC LIMIT 12) x;

    -- c) crédito: CxC creadas en el período y cobros recibidos en el período
    SELECT jsonb_build_object(
               'cuentas', COALESCE(cx.n, 0), 'cuentas_usd', COALESCE(cx.usd, 0),
               'cobros', COALESCE(cb.n, 0), 'cobros_usd', COALESCE(cb.usd, 0), 'cobros_ves', COALESCE(cb.ves, 0),
               'vencidas_hoy', (SELECT count(*) FROM cuentas_por_cobrar WHERE estado = 'PENDIENTE' AND fecha_vencimiento < p_hasta))
      INTO credito
      FROM (SELECT count(*) AS n, COALESCE(sum(monto_original_usd), 0) AS usd
              FROM cuentas_por_cobrar
             WHERE (created_at AT TIME ZONE 'America/Caracas')::date BETWEEN p_desde AND p_hasta) cx,
           (SELECT count(*) AS n, COALESCE(sum(monto_usd), 0) AS usd, COALESCE(sum(monto_ves), 0) AS ves
              FROM pagos_cobrar WHERE estado = 'ACTIVO' AND fecha BETWEEN p_desde AND p_hasta) cb;

    -- d) anticipos de encargos: cobrados en el período (dinero que entró) y aplicados en entregas del período
    SELECT jsonb_build_object(
               'cobrados', COALESCE(a.n, 0), 'cobrados_usd', COALESCE(a.usd, 0),
               'aplicados', COALESCE(b.n, 0), 'aplicados_usd', COALESCE(b.usd, 0))
      INTO anticipos
      FROM (SELECT count(*) AS n, COALESCE(sum(monto_usd), 0) AS usd
              FROM encargos_pagos WHERE (created_at AT TIME ZONE 'America/Caracas')::date BETWEEN p_desde AND p_hasta) a,
           (SELECT count(*) AS n, COALESCE(sum(pv.monto_usd), 0) AS usd
              FROM pagos_venta pv JOIN ventas v ON v.id = pv.venta_id
             WHERE pv.es_anticipo AND v.estado = 'COMPLETADA' AND v.fecha_valor BETWEEN p_desde AND p_hasta) b;

    -- e) ingresos/egresos de caja del período por origen
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'origen', x.origen, 'tipo', x.tipo, 'n', x.n, 'monto_usd', x.usd, 'monto_ves', x.ves)
                ORDER BY x.origen, x.tipo), '[]'::jsonb) INTO movs
      FROM (SELECT m.origen, m.tipo, count(*) AS n, COALESCE(sum(m.monto_usd), 0) AS usd, COALESCE(sum(m.monto_ves), 0) AS ves
              FROM movimientos_caja m
             WHERE m.estado = 'ACTIVO' AND (m.created_at AT TIME ZONE 'America/Caracas')::date BETWEEN p_desde AND p_hasta
             GROUP BY m.origen, m.tipo) x;

    -- f) correlativo: cuántos cierres firmados lleva esa caja (o todas) en el último día del período
    SELECT count(*) + 1 INTO correlativo
      FROM cierres_caja
     WHERE fecha = p_hasta AND (COALESCE(p_usuario_id, 0) = 0 OR usuario_id = p_usuario_id);

    SELECT count(*) FILTER (WHERE v.estado = 'COMPLETADA') AS n,
           COALESCE(sum(v.total_cobrar_usd) FILTER (WHERE v.estado = 'COMPLETADA'), 0) AS usd,
           COALESCE(sum(v.total_cobrar_ves) FILTER (WHERE v.estado = 'COMPLETADA'), 0) AS ves,
           count(*) FILTER (WHERE v.estado = 'ANULADA') AS anuladas
      INTO res FROM ventas v WHERE v.fecha_valor BETWEEN p_desde AND p_hasta;

    RETURN jsonb_build_object(
        'desde', p_desde, 'hasta', p_hasta, 'usuario_id', COALESCE(p_usuario_id, 0),
        'ventas', COALESCE(res.n, 0), 'total_usd', COALESCE(res.usd, 0), 'total_ves', COALESCE(res.ves, 0),
        'anuladas', COALESCE(res.anuladas, 0),
        'ticket_promedio_usd', CASE WHEN COALESCE(res.n, 0) > 0 THEN ROUND(res.usd / res.n, 2) END,
        'por_hora', horas, 'top_productos', tops, 'credito', credito, 'anticipos', anticipos,
        'movimientos_caja', movs, 'correlativo_corte', correlativo);
END $$;
COMMENT ON FUNCTION fn_corte_desglose(date, date, bigint) IS 'Desglose gerencial del corte de caja: ventas por hora, top de piezas, crédito del día, anticipos de encargos, ingresos/egresos por origen y correlativo del corte.';
