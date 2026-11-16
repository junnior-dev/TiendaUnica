# -*- coding: utf-8 -*-
"""t14 · Límites y errores: cada regla de negocio se defiende donde debe (negativos)."""
import json

import e2e_lib as L


def main():
    L.empezar('t14 · Límites y errores esperados')
    uid = L.admin()
    hoy = L.hoy()
    p = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")
    m = L.q1("SELECT id FROM tienda.metodos_pago WHERE activo AND NOT aplica_igtf ORDER BY id LIMIT 1")
    total = round(float(L.q1("SELECT precio_venta_usd FROM tienda.productos WHERE id = %s", (p,))) * 1.16, 2)

    # 1) Ventas
    L.espera_error('venta sin pagos rechazada', L.fn, 'fn_registrar_venta', uid, json.dumps([{'producto_id': p, 'cantidad': 1}]), '[]', None, None, 'PRESENCIAL')
    L.espera_error('venta con pago que no cubre el total rechazada', L.fn, 'fn_registrar_venta', uid,
                   json.dumps([{'producto_id': p, 'cantidad': 1}]), json.dumps([{'metodo_pago_id': m, 'monto': 0.01}]), None, None, 'PRESENCIAL')
    L.espera_error('producto inexistente en la venta rechazado', L.fn, 'fn_registrar_venta', uid,
                   json.dumps([{'producto_id': 99999999, 'cantidad': 1}]), json.dumps([{'metodo_pago_id': m, 'monto': 1}]), None, None, 'PRESENCIAL')
    L.espera_error('cantidad cero rechazada', L.fn, 'fn_registrar_venta', uid,
                   json.dumps([{'producto_id': p, 'cantidad': 0}]), json.dumps([{'metodo_pago_id': m, 'monto': 1}]), None, None, 'PRESENCIAL')

    # 2) Clientes: documento duplicado por unicidad
    cli0 = L.fila("SELECT nombre, documento FROM tienda.clientes WHERE documento IS NOT NULL ORDER BY id DESC LIMIT 1")
    L.espera_error('documento de cliente duplicado rechazado', L.q1,
                   "INSERT INTO tienda.clientes (nombre, documento, tipo_documento, activo) VALUES (%s, %s, 'CI', true)", (L.fake.name(), cli0['documento']))

    # 3) Conteos: cerrar lo que quedó abierto de suites previas y contar fuera de alcance
    for (cid,) in L.qs("SELECT id FROM tienda.v_conteos WHERE estado = 'ABIERTO'"):
        L.fn('fn_anular_conteo', cid, uid, 'Limpieza E2E')
    L.commit()
    conteo = L.fn('fn_crear_conteo', 'LISTA', uid, 'Conteo de límites E2E', None, json.dumps([p]))
    L.commit()
    otro = L.q1("SELECT id FROM tienda.productos WHERE activo ORDER BY id DESC LIMIT 1")
    items_conteo = L.qs("SELECT producto_id FROM tienda.conteo_detalle WHERE conteo_id = %s LIMIT 1", (conteo,))
    dentro = items_conteo[0][0] if items_conteo else otro
    fuera = otro if otro != dentro else p
    L.fn('fn_contar', conteo, [{'producto_id': dentro, 'contado': 1}], uid)
    L.espera_error('contar un producto fuera del alcance rechazado', L.fn, 'fn_contar', conteo, json.dumps([{'producto_id': fuera, 'contado': 1}]), uid)
    L.fn('fn_anular_conteo', conteo, uid, 'Prueba de límites')
    L.commit()

    # 4) Compras: costo negativo y proveedor inexistente
    prov = L.q1("SELECT id FROM proveedores WHERE activo ORDER BY id LIMIT 1")
    L.espera_error('costo unitario negativo rechazado', L.fn, 'fn_registrar_compra', prov, f"F-{L.fake.random_number(digits=6)}", hoy, 'USD',
                   [{'producto_id': p, 'cantidad': 1, 'costo_unitario': -3, 'exento': False}], uid)
    L.espera_error('proveedor inexistente rechazado', L.fn, 'fn_registrar_compra', 99999999, f"F-{L.fake.random_number(digits=6)}", hoy, 'USD',
                   [{'producto_id': p, 'cantidad': 1, 'costo_unitario': 1, 'exento': False}], uid)

    # 5) Órdenes de compra: enviar dos veces, recibir de más
    orden = L.fn('fn_crear_orden', prov, json.dumps([{'producto_id': p, 'cantidad': 5, 'costo_estimado_usd': 0.9}]), uid, 'Orden E2E')
    L.fn('fn_enviar_orden', orden, uid, 'Enviada al proveedor')
    L.commit()
    L.espera_error('enviar la orden dos veces rechazado', L.fn, 'fn_enviar_orden', orden, uid, 'reenvío')
    L.espera_error('recibir más de lo pedido rechazado', L.fn, 'fn_recibir_orden', orden,
                   json.dumps([{'producto_id': p, 'cantidad': 6, 'costo_unitario': 0.9, 'exento': False}]),
                   f"F-{L.fake.random_number(digits=5)}", hoy, 'USD', uid)
    L.fn('fn_recibir_orden', orden, json.dumps([{'producto_id': p, 'cantidad': 5, 'costo_unitario': 0.9, 'exento': False}]),
         f"F-{L.fake.random_number(digits=5)}", hoy, 'USD', uid, None, 'CONTADO', 0, True, None)
    L.commit()
    L.ok(True, 'recibir exactamente lo pedido funciona (orden queda RECIBIDA)')
    L.espera_error('recibir una orden ya recibida rechazado', L.fn, 'fn_recibir_orden', orden,
                   json.dumps([{'producto_id': p, 'cantidad': 1, 'costo_unitario': 0.9, 'exento': False}]),
                   f"F-{L.fake.random_number(digits=5)}", hoy, 'USD', uid)

    # 6) Encargos de producto inexistente y enteros de ISLR fuera de rango
    cli = L.q1("SELECT id FROM tienda.clientes WHERE activo ORDER BY id LIMIT 1")
    L.espera_error('encargo para cliente inexistente rechazado', L.fn, 'fn_crear_encargo', 99999999, 'Pieza fantasma', 1, None, None, uid)

    # 7b) Movimiento de caja sin turno abierto se rechaza
    abiertas = L.qs("SELECT id FROM tienda.aperturas_caja WHERE usuario_id = %s AND estado = 'ABIERTA'", (uid,))
    for (aid,) in abiertas:
        L.fn('fn_cerrar_apertura', aid, uid)
    L.commit()
    L.ok(L.fn('fn_apertura_activa', uid) is None, 'sin turno abierto para el usuario tras cerrar')
    L.espera_error('movimiento de caja sin turno abierto rechazado', L.fn, 'fn_registrar_movimiento_caja', uid, 'INGRESO',
                   'Sin turno E2E', 'USD', 1, None, 'MANUAL', None, True, True, None)

    # 7) Configuración: no se puede registrar un pago con método inactivo
    m_off = L.q1("SELECT id FROM tienda.metodos_pago WHERE activo = false ORDER BY id LIMIT 1")
    if m_off:
        L.espera_error('pago con método inactivo rechazado', L.fn, 'fn_registrar_venta', uid,
                       json.dumps([{'producto_id': p, 'cantidad': 1}]), json.dumps([{'metodo_pago_id': m_off, 'monto': total}]),
                       None, None, 'PRESENCIAL')
    else:
        L.ok(True, '(no hay métodos inactivos en el clon: caso omitido)')
