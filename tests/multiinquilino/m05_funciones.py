# -*- coding: utf-8 -*-
"""m05 · FUNCIONES POR NEGOCIO: caja, cotización, venta, correlativo, kardex y
factura fiscal quedan aislados por negocio (los singletons ahora leen
fn_negocio_actual)."""
import json

import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402


def main():
    L.empezar('m05 · FUNCIONES POR NEGOCIO: venta y caja aisladas')
    M.como(2)
    uid = M.uid_de('admin_bodega')
    L.ok(uid is not None, f'usuario de la sesión del negocio 2: admin_bodega #{uid}')
    p = M.producto_base('M2-ACEITE', 'Aceite 20W-50 Bodega', precio=10.0, costo=7.0)
    M.carga_stock(p, uid)
    L.commit()
    L.ok(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (p,)) == 50,
         'inventario inicial del producto del negocio 2: 50 unidades')
    items = [{'producto_id': p, 'cantidad': 2, 'descuento_pct': 0}]
    cot = L.fn_fila('fn_cotizar_venta', json.dumps(items))
    L.ok(float(cot['base_usd']) == 20.0 and float(cot['iva_pct']) == 16.0
         and float(cot['total_usd']) == 23.20,
         f'cotización con las reglas del negocio 2: base {cot["base_usd"]} + IVA 16% → {cot["total_usd"]}')
    ap = L.fn('fn_abrir_caja', uid, 50, 500)
    L.commit()
    L.ok(L.q1("SELECT negocio_id FROM tienda.aperturas_caja WHERE id = %s", (ap,)) == 2,
         f'caja abierta #{ap} y sellada para el negocio 2 (config por negocio)')
    L.espera_error('no se puede abrir dos veces el mismo turno (regla del negocio 2)',
                   L.fn, 'fn_abrir_caja', uid, 10, 10)
    L.rollback()
    m_pmovil = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = 'Pago móvil' AND activo")
    venta = L.fn('fn_registrar_venta', uid, json.dumps(items), json.dumps(
        [{'metodo_pago_id': m_pmovil, 'monto': float(cot['total_usd']) * float(cot['tasa_cambio']),
          'referencia': 'PM-MULTI-1'}]), None, 'Venta multiinquilino', 'PRESENCIAL', False, 0)
    L.commit()
    va = L.fila("SELECT negocio_id, numero FROM tienda.ventas WHERE id = %s", (venta,))
    L.ok(va and va['negocio_id'] == 2, f'venta #{venta} sellada para el negocio 2')
    L.ok(va['numero'] == 1, f'correlativo POR NEGOCIO: la venta es la #1 del negocio 2 '
                            '(aunque el negocio 1 ya venda desde hace tiempo)')
    L.ok(L.q1("SELECT count(*) FROM tienda.pagos_venta WHERE venta_id = %s AND negocio_id = 2", (venta,)) == 1,
         'el pago de la venta quedó sellado para el negocio 2')
    L.ok(L.q1("SELECT sum(cantidad) FROM tienda.movimientos_inventario "
              "WHERE referencia_tipo = 'VENTA' AND referencia_id = %s AND producto_id = %s",
              (venta, p)) == -2.0, 'kardex: salida de 2 unidades en el producto del negocio 2')
    M.volver()
    fact_n1_antes = L.q1("SELECT siguiente_factura FROM tienda.numeracion_fiscal WHERE id = 1")
    L.ok(fact_n1_antes is not None, 'numeración del negocio 1 visible para el portal antes de emitir facturas')

    L.empezar('m05 · FUNCIONES POR NEGOCIO: factura fiscal del negocio 2')
    M.como(2)
    cli = L.ins('clientes', tipo_documento='V', documento='555-FISCAL', nombre='Cliente Fiscal N2', activo=True)
    venta_f = L.fn('fn_registrar_venta', uid, json.dumps(items[:1]), json.dumps(
        [{'metodo_pago_id': m_pmovil, 'monto': float(cot['total_usd']) * float(cot['tasa_cambio']),
          'referencia': 'PM-MULTI-2'}]), cli, 'Venta fiscal N2', 'PRESENCIAL', True, 0)
    L.commit()
    L.fn('fn_emitir_factura_fiscal', venta_f)
    L.commit()
    L.ok(L.q1("SELECT numero_factura_fiscal FROM tienda.ventas WHERE id = %s", (venta_f,)) == 'FAC-00000001',
         'factura fiscal #1 del negocio 2 (su propia numeración, la del negocio 1 sigue intacta)')
    L.ok(L.fn('fn_regimen_calendario') in ('ORDINARIO', 'ESPECIAL'),
         f'régimen fiscal leído de la config del negocio 2: {L.fn("fn_regimen_calendario")}')
    M.volver()
    L.ok(L.q1("SELECT siguiente_factura FROM tienda.numeracion_fiscal WHERE id = 1") == fact_n1_antes,
         'la numeración del negocio 1 no se movió (independencia de correlativos)')
    M.volver()
