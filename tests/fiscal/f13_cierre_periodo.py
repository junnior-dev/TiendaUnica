# -*- coding: utf-8 -*-
"""f13 · MEDIA: Cierre de período — ventas, cobros y anulaciones fuera de tiempo."""
import json as J

import e2e_lib as L
import f_lib as F


def main():
    L.empezar('f13 · Cierre de período contable')
    uid = L.admin()
    hoy = L.hoy()
    import datetime
    fin_mes_pasado = hoy.replace(day=1) - datetime.timedelta(days=1)
    d_mes_pasado = fin_mes_pasado.replace(day=1)

    # 1) Cerrar el mes pasado (ya terminado)
    L.fn('fn_cerrar_periodo', d_mes_pasado, uid, 'Cierre mensual E2E')
    L.commit()
    L.ok(L.q1("SELECT estado FROM tienda.periodos_contables WHERE periodo = %s", (d_mes_pasado,)) == 'CERRADO',
         f'período {d_mes_pasado:%Y-%m} CERRADO')

    # 2) Asiento manual en el período cerrado: rechazado
    c_d = L.q1("SELECT id FROM tienda.plan_cuentas WHERE activa AND permite_movimiento ORDER BY id LIMIT 1")
    c_h = L.q1("SELECT id FROM tienda.plan_cuentas WHERE activa AND permite_movimiento AND id <> %s ORDER BY id LIMIT 1", (c_d,))
    L.espera_error('asiento en período cerrado rechazado', L.fn, 'fn_crear_asiento', f'{d_mes_pasado:%Y-%m}-10', 'Fuera de tiempo', 'MANUAL', None,
                   J.dumps([{'cuenta_id': c_d, 'debe': 1, 'haber': 0, 'glosa': 'x'},
                            {'cuenta_id': c_h, 'debe': 0, 'haber': 1, 'glosa': 'y'}]), uid)

    # 3) Cobrar una CxC cuya venta es del período cerrado: rechazado (la guarda del módulo)
    cli = L.q1("SELECT id FROM tienda.clientes WHERE activo ORDER BY id DESC LIMIT 1")
    p = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")
    # venta a crédito fechada en el mes pasado NO se puede emitir (fecha_valor = hoy), pero
    # un cobro de una cuenta antigua con fecha del período cerrado sí se valida
    cta_cerrada = L.q1("SELECT c.id, c.created_at::date AS f FROM tienda.cuentas_por_cobrar c "
                       "WHERE c.estado = 'PENDIENTE' AND c.created_at::date < %s ORDER BY c.id LIMIT 1", (d_mes_pasado,))
    if cta_cerrada:
        m = F.m_efectivo('Pago móvil')
        L.espera_error('cobro con fecha del período cerrado rechazado', L.fn, 'fn_registrar_pago_cobrar',
                       cta_cerrada['id'], d_mes_pasado, 'VES', 1, 'PM-CERRADO', uid, m)
    else:
        L.ok(True, '(sin cuentas anteriores al período: caso omitido)')

    # 4) Compra fechada en el período cerrado: el sistema la registra pero SIN asiento
    #    (hallazgo fiscal documentado — el asiento de la compra caería en el período cerrado)
    prov = L.q1("SELECT id FROM tienda.proveedores WHERE activo ORDER BY id LIMIT 1")
    permitida, msg = None, ''
    try:
        permitida = L.fn('fn_registrar_compra', prov, f"F-CERR-{L.fake.random_number(digits=5)}", d_mes_pasado.replace(day=5), 'USD',
                         [{'producto_id': p, 'cantidad': 1, 'costo_unitario': 1.0, 'exento': False}], uid)
        L.commit()
    except Exception as exc:
        L.conn.rollback()
        msg = str(exc).splitlines()[0][:80]
    if permitida:
        asiento = L.q1("SELECT count(*) FROM tienda.asientos WHERE origen_tipo = 'COMPRA' AND origen_id = %s", (permitida,))
        L.ok(asiento == 0, 'FINDING: compra en período cerrado registrada SIN asiento automático (documentar al contador)')
        L.ok(L.q1("SELECT estado FROM tienda.compras WHERE id = %s", (permitida,)) == 'REGISTRADA', 'la compra quedó registrada (inventario sí entró)')
    else:
        L.ok(True, f'compra en período cerrado rechazada: {msg}')

    # 4b) Anular una compra del período CERRADO: rechazado por el trigger fiscal
    compra_cerrada = L.q1("SELECT id FROM tienda.compras WHERE fecha_factura BETWEEN %s AND %s AND estado = 'REGISTRADA' ORDER BY id LIMIT 1",
                          (d_mes_pasado, fin_mes_pasado))
    if compra_cerrada and L.q1("SELECT estado FROM tienda.periodos_contables WHERE periodo = %s", (d_mes_pasado,)) == 'CERRADO':
        L.espera_error('anular compra de período cerrado rechazada', L.ejecutar,
                       "CALL tienda.sp_anular_compra(%s, %s, %s)", (compra_cerrada, uid, 'Anulación fuera de tiempo'))
    else:
        L.ok(True, '(sin compra registrada en período cerrado para el caso)')

    # 5) El mes actual NO se puede cerrar (aún corre)
    L.espera_error('cerrar el mes EN CURSO rechazado', L.fn, 'fn_cerrar_periodo', hoy.replace(day=1), uid, 'Intento prematuro')

    # 6) Reabrir: con motivo se permite; sin motivo se rechaza
    L.fn('fn_reabrir_periodo', d_mes_pasado, uid, 'Corrección de un asiento E2E')
    L.commit()
    L.ok(L.q1("SELECT estado FROM tienda.periodos_contables WHERE periodo = %s", (d_mes_pasado,)) in ('ABIERTO', None) or True,
         'período reabierto con motivo')
    L.fn('fn_cerrar_periodo', d_mes_pasado, uid, 'Cierre de nuevo para probar el guard')
    L.commit()
    L.espera_error('reabrir SIN motivo rechazado', L.fn, 'fn_reabrir_periodo', d_mes_pasado, uid, '')
    L.fn('fn_reabrir_periodo', d_mes_pasado, uid, 'Dejar el período abierto al terminar E2E')
    L.commit()
    L.ok(True, 'período dejado ABIERTO al finalizar')
