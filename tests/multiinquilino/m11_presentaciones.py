# -*- coding: utf-8 -*-
"""m11 · PRESENTACIONES DE VENTA (38_presentaciones_venta.sql): vender el mismo producto por pieza, caja o
docena; el inventario sigue en piezas; precio propio o derivado; aislado por negocio."""
import json

import e2e_lib as L  # noqa: E402
import m_lib as M  # noqa: E402


def pagar(total_usd, tasa):
    m = L.q1("SELECT id FROM tienda.metodos_pago WHERE nombre = 'Pago móvil' AND activo")
    return json.dumps([{'metodo_pago_id': m, 'monto': round(float(total_usd) * float(tasa), 2), 'referencia': 'PM-PRES'}])


def vender(uid, items):
    cot = L.fn_fila('fn_cotizar_venta', json.dumps(items))
    v = L.fn('fn_registrar_venta', uid, json.dumps(items), pagar(cot['total_usd'], cot['tasa_cambio']), None, None, 'PRESENCIAL', False, 0)
    return v, cot


def main():
    L.empezar('m11 · PRESENTACIONES: estructura multiinquilino')
    M.volver()
    r = L.fila("SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS f, "
               "(SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'p_tenant') AS pol, "
               "(SELECT count(*) FROM pg_trigger g WHERE g.tgrelid = c.oid AND g.tgname = 'trg_sello_negocio') AS sello "
               "FROM pg_class c WHERE c.oid = 'tienda.producto_presentaciones'::regclass")
    L.ok(r and r['rls'] and r['f'] and r['pol'] == 1 and r['sello'] == 1, 'producto_presentaciones: RLS FORCE + p_tenant + sello')

    L.empezar('m11 · PRESENTACIONES: caja y pieza en el negocio 2')
    M.como(2)
    uid = M.uid_de('admin_bodega')
    if L.q1("SELECT tienda.fn_apertura_activa(%s)", (uid,)) is None:
        L.fn('fn_abrir_caja', uid, 50, 500)
    p = M.producto_base('M11-BUJIA', 'Bujía NGK Presentaciones', precio=10.0, costo=7.0)
    M.carga_stock(p, uid, 100)
    caja = L.fn('fn_presentacion_guardar', p, 'caja12', 'Caja × 12', 12, 100, '7501234567890')
    doc = L.fn('fn_presentacion_guardar', p, 'DOC', 'Docena', 12, None, None)
    L.commit()
    L.ok(L.q1("SELECT codigo FROM tienda.producto_presentaciones WHERE id = %s", (caja,)) == 'CAJA12', 'el código de la presentación se normaliza a mayúsculas')
    L.ok(L.q1("SELECT negocio_id FROM tienda.producto_presentaciones WHERE id = %s", (caja,)) == 2, 'la presentación queda sellada para el negocio 2')

    L.espera_error('factor 1 no es una presentación (la pieza suelta ya existe)', L.fn, 'fn_presentacion_guardar', p, 'X1', 'Uno', 1, None, None); L.rollback()
    L.espera_error('código con espacios', L.fn, 'fn_presentacion_guardar', p, 'CAJA 6', 'Caja 6', 6, None, None); L.rollback()
    L.espera_error('código de barras repetido', L.fn, 'fn_presentacion_guardar', p, 'PK6', 'Pack 6', 6, None, '7501234567890'); L.rollback()
    L.espera_error('código de la misma presentación repetido', L.fn, 'fn_presentacion_guardar', p, 'DOC', 'Otra', 6, None, None); L.rollback()

    cot = L.fn_fila('fn_cotizar_venta', json.dumps([{'producto_id': p, 'cantidad': 2, 'presentacion_id': caja}]))
    L.ok(float(cot['base_usd']) == 200.0 and float(cot['total_usd']) == 232.0, f'2 cajas a 100 c/u: base {cot["base_usd"]} + IVA → {cot["total_usd"]}')

    v1, _ = vender(uid, [{'producto_id': p, 'cantidad': 2, 'presentacion_id': caja}])
    L.commit()
    d = L.fila("SELECT * FROM tienda.detalle_venta WHERE venta_id = %s", (v1,))
    L.ok(float(d['cantidad']) == 24 and float(d['cantidad_presentacion']) == 2 and d['presentacion_codigo'] == 'CAJA12'
         and float(d['presentacion_factor']) == 12 and float(d['precio_presentacion_usd']) == 100, 'la línea guarda 2 cajas = 24 piezas, con su código, factor y precio')
    L.ok(float(d['total_usd']) == 232.0 and float(d['costo_unitario_usd']) == 7.0, 'total de la línea 232 y costo por pieza intacto (7)')
    L.ok('Caja × 12' in d['descripcion'], 'la descripción de la línea dice la presentación vendida')
    L.ok(float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (p,))) == 76, 'stock en piezas: 100 − 24 = 76')
    L.ok(float(L.q1("SELECT sum(cantidad) FROM tienda.movimientos_inventario WHERE referencia_tipo='VENTA' AND referencia_id = %s", (v1,))) == -24, 'kardex: salida de 24 piezas')

    v2, _ = vender(uid, [{'producto_id': p, 'cantidad': 3}])
    L.commit()
    d2 = L.fila("SELECT * FROM tienda.detalle_venta WHERE venta_id = %s", (v2,))
    L.ok(d2['presentacion_id'] is None and float(d2['cantidad']) == 3 and float(d2['total_usd']) == 34.80, 'venta por pieza sigue igual: 3 × 10 + IVA = 34,80')

    v3, c3 = vender(uid, [{'producto_id': p, 'cantidad': 1, 'presentacion_id': doc}])
    L.commit()
    L.ok(float(c3['base_usd']) == 120.0 and float(L.q1("SELECT base_usd FROM tienda.detalle_venta WHERE venta_id = %s", (v3,))) == 120.0,
         'docena sin precio propio = precio de la pieza × 12 = 120')

    v4, c4 = vender(uid, [{'producto_id': p, 'cantidad': 1, 'presentacion_id': caja, 'descuento_pct': 10}, {'producto_id': p, 'cantidad': 2}])
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.detalle_venta WHERE venta_id = %s", (v4,)) == 2
         and float(L.q1("SELECT total_usd FROM tienda.ventas WHERE id = %s", (v4,))) == float(c4['total_usd']),
         f'caja con 10 % de descuento + 2 piezas en la misma venta: total {c4["total_usd"]} igual a la cotización')
    L.ok(float(L.q1("SELECT stock_actual FROM tienda.productos WHERE id = %s", (p,))) == 76 - 3 - 12 - 12 - 2, 'stock tras 4 ventas: 47')

    L.espera_error('no se puede vender más cajas de las que hay (10 cajas = 120 piezas)', vender, uid, [{'producto_id': p, 'cantidad': 10, 'presentacion_id': caja}])
    L.rollback()

    otro = M.producto_base('M11-OTRO', 'Otro producto', precio=5.0, costo=3.0)
    M.carga_stock(otro, uid, 10)
    L.commit()
    L.espera_error('una presentación de otro producto no se puede usar', vender, uid, [{'producto_id': otro, 'cantidad': 1, 'presentacion_id': caja}], contiene='no pertenece')
    L.rollback()

    L.fn('fn_presentacion_desactivar', doc); L.commit()
    L.espera_error('una presentación desactivada no se vende', vender, uid, [{'producto_id': p, 'cantidad': 1, 'presentacion_id': doc}], contiene='desactivada')
    L.rollback()
    L.ok(L.q1("SELECT count(*) FROM tienda.detalle_venta WHERE presentacion_id = %s", (doc,)) == 1, 'desactivar no borra: la venta ya hecha conserva su presentación')

    L.empezar('m11 · VENTA A CRÉDITO: plazo elegido por el cajero y cuenta por cobrar')
    M.volver()
    L.ejecutar("INSERT INTO tienda.clientes (negocio_id, tipo_documento, documento, nombre, activo) VALUES (2, 'V', '12345678-M11', 'Cliente Crédito M11', true)")
    cli = L.q1("SELECT id FROM tienda.clientes WHERE negocio_id = 2 AND documento = '12345678-M11'")
    L.commit(); M.como(2)
    items = [{'producto_id': p, 'cantidad': 1, 'presentacion_id': caja}]
    vc = L.fn('fn_registrar_venta', uid, json.dumps(items), json.dumps([]), cli, None, 'PRESENCIAL', True, 45)
    L.commit()
    c = L.fila("SELECT c.saldo_usd, c.fecha_vencimiento - v.fecha_valor AS dias, v.total_usd FROM tienda.cuentas_por_cobrar c JOIN tienda.ventas v ON v.id = c.venta_id WHERE c.venta_id = %s", (vc,))
    L.ok(c and c['dias'] == 45 and float(c['saldo_usd']) == float(c['total_usd']), 'crédito a 45 días sin abono: la cuenta por cobrar es por el total y vence a los 45 días')
    L.espera_error('el crédito sin cliente es rechazado', L.fn, 'fn_registrar_venta', uid, json.dumps(items), json.dumps([]), None, None, 'PRESENCIAL', True, 30); L.rollback()
    M.como(2)

    L.empezar('m11 · PRESENTACIONES: aislamiento entre negocios')
    M.como(1)
    L.ok(L.q1("SELECT count(*) FROM tienda.producto_presentaciones") == 0, 'el negocio 1 no ve las presentaciones del negocio 2')
    uid1 = L.q1("SELECT min(id) FROM tienda.usuarios WHERE negocio_id = 1")
    L.espera_error('el negocio 1 no puede usar la presentación del negocio 2', L.fn, 'fn_cotizar_venta', json.dumps([{'producto_id': p, 'cantidad': 1, 'presentacion_id': caja}]))
    L.rollback()
    M.como(1)
    L.espera_error('el negocio 1 no puede desactivar la presentación del negocio 2', L.fn, 'fn_presentacion_desactivar', caja, contiene='no existe')
    L.rollback()
    M.volver()
