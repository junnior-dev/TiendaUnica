# -*- coding: utf-8 -*-
"""t15 · Integridad global: conciliaciones cruzadas entre módulos al terminar el día E2E."""
import e2e_lib as L


def main():
    L.empezar('t15 · Integridad global (conciliaciones)')
    hoy = L.hoy()

    # 1) Stock físico = saldo del kardex para TODO el catálogo
    mal = L.q1("SELECT count(*) FROM tienda.productos p WHERE p.stock_actual <> COALESCE((SELECT stock_resultante FROM tienda.v_kardex k "
               "WHERE k.producto_id = p.id ORDER BY k.id DESC LIMIT 1), p.stock_actual)")
    L.ok(mal == 0, f'stock de todos los productos cuadra con el kardex ({mal} desajustes)')

    # 2) Cada venta de contado: pagos = total (la misma regla que aplica fn_validar_pagos_venta);
    #    las de crédito se cubren por su cuenta por cobrar y el IGTF va encima del total
    mal_v = L.qs("SELECT v.id FROM tienda.ventas v LEFT JOIN tienda.pagos_venta p ON p.venta_id = v.id "
                 "WHERE v.estado <> 'ANULADA' AND NOT v.es_credito GROUP BY v.id "
                 "HAVING abs(v.total_usd - COALESCE(sum(p.monto_usd), 0)) > 0.02")
    L.ok(len(mal_v) == 0, f'todas las ventas de contado cobradas al centavo ({len(mal_v)} desajustes)')
    mal_ig = L.qs("SELECT id FROM tienda.ventas WHERE igtf_usd > 0 AND abs(total_cobrar_usd - total_usd - igtf_usd) > 0.01")
    L.ok(len(mal_ig) == 0, f'total cobrar = total + IGTF en ventas con IGTF ({len(mal_ig)} desajustes)')

    # 3) Ventas anuladas: devolvieron el inventario (kardex tipo ANULACION_VENTA con referencia a la venta)
    faltan = L.qs("SELECT DISTINCT v.id FROM tienda.ventas v JOIN tienda.detalle_venta d ON d.venta_id = v.id "
                  "WHERE v.estado = 'ANULADA' AND NOT EXISTS (SELECT 1 FROM tienda.movimientos_inventario m "
                  "WHERE m.tipo = 'ANULACION_VENTA' AND m.referencia_tipo = 'VENTA' AND m.referencia_id = v.id AND m.producto_id = d.producto_id)")
    L.ok(len(faltan) == 0, f'toda venta anulada devolvió su inventario ({len(faltan)} sin movimiento)')

    # 4) Contabilidad cuadrada: debe = haber en todos los asientos
    descuadre = L.q1("SELECT count(*) FROM (SELECT a.id, (SELECT sum(d.debe) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) AS debe, "
                     "(SELECT sum(d.haber) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) AS haber FROM tienda.asientos a) x "
                     "WHERE abs(debe - haber) > 0.01")
    L.ok(descuadre == 0, f'todos los asientos cuadran ({descuadre} descuadrados)')

    # 5) CxC: saldo = monto original − pagos activos
    mal_cxc = L.qs("SELECT c.id FROM tienda.cuentas_por_cobrar c WHERE c.estado <> 'ANULADA' AND abs(c.saldo_usd - "
                   "(c.monto_original_usd - COALESCE((SELECT sum(p.monto_usd) FROM tienda.pagos_cobrar p WHERE p.cuenta_por_cobrar_id = c.id "
                   "AND p.estado = 'ACTIVO'), 0))) > 0.05")
    L.ok(len(mal_cxc) == 0, f'saldos de CxC consistentes ({len(mal_cxc)} desajustes)')

    # 6) CxP: el saldo de la vista = total − pagado (consistencia interna del módulo)
    mal_cxp = L.qs("SELECT compra_id FROM tienda.v_cuentas_por_pagar WHERE abs(saldo_usd - (total_usd - pagado_usd)) > 0.05")
    L.ok(len(mal_cxp) == 0, f'saldos de CxP consistentes ({len(mal_cxp)} desajustes)')

    # 7) Encargos entregados tienen venta y su historial de anticipos
    mal_e = L.qs("SELECT id FROM tienda.encargos WHERE estado = 'ENTREGADO' AND (venta_id IS NULL OR "
                 "NOT EXISTS (SELECT 1 FROM tienda.encargos_pagos p WHERE p.encargo_id = encargos.id))")
    L.ok(len(mal_e) == 0, f'encargos ENTREGADOS con venta e historial ({len(mal_e)} huérfanos)')

    # 8) Movimientos de caja del día ligados a aperturas y con usuario
    huerfanos = L.q1("SELECT count(*) FROM tienda.movimientos_caja WHERE apertura_id IS NULL AND origen <> 'SISTEMA'")
    L.ok(huerfanos == 0, f'todos los movimientos de caja pertenecen a un turno ({huerfanos} huérfanos)')

    # 9) Correlativo de ventas: los intentos fallidos dejan huecos de secuencia (comportamiento
    # estándar de Postgres); lo que se audita es que no crezcan de forma descontrolada
    huecos = L.q1("SELECT count(*) FROM tienda.v_ventas_huecos")
    L.ok(huecos <= L.HUECOS_BASE + 3, f'correlativo de ventas sin huecos nuevos inesperados ({huecos}, base {L.HUECOS_BASE})')

    # 10) Vistas clave de los módulos responden (matriz de módulos vivos)
    for v in ['v_encargos', 'v_ordenes_compra', 'v_conteos', 'v_cuentas_por_cobrar', 'v_cuentas_por_pagar',
              'v_libro_ventas', 'v_libro_compras', 'v_kardex', 'v_combos', 'v_retenciones_iva',
              'v_ventas_resumen', 'v_valor_inventario', 'v_tasas_actuales', 'v_metodos_pago_uso']:
        L.ok(L.q1(f"SELECT count(*) FROM tienda.{v}") is not None, f'vista {v} responde')
