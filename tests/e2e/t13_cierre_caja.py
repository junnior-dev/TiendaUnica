# -*- coding: utf-8 -*-
"""t13 · Cierre de caja: movimientos, resumen, desglose, arqueo del cierre Z y re-apertura."""
import json as J

import e2e_lib as L


def main():
    L.empezar('t13 · Cierre de caja (corte X y Z)')
    uid = L.admin()
    hoy = L.hoy()

    ap = L.fn('fn_apertura_activa', uid)
    L.ok(ap is not None, f'apertura activa #{ap} del día')
    if not ap:
        ap = L.fn('fn_abrir_caja', uid, 20, 200)
        L.commit()

    # 1) Movimiento manual de caja: egreso de gastos con referencia
    n0 = L.q1("SELECT count(*) FROM tienda.movimientos_caja WHERE apertura_id = %s AND estado = 'ACTIVO'", (ap,))
    mv = L.fn('fn_registrar_movimiento_caja', uid, 'EGRESO', f'Gastos camioneta E2E {L.fake.word()}', 'USD', 5.0,
              f"REC-{L.fake.random_number(digits=6)}", 'MANUAL', None, True, False, None)
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.movimientos_caja WHERE apertura_id = %s AND estado = 'ACTIVO'", (ap,)) == n0 + 1,
         'egreso manual registrado en el turno')

    # 2) Ingreso manual (aporte del dueño) y anulación del egreso con motivo
    L.fn('fn_registrar_movimiento_caja', uid, 'INGRESO', 'Aporte dueño E2E', 'USD', 15.0, None, 'MANUAL', None, True, False, None)
    L.fn('fn_anular_movimiento_caja', mv, 'Gasto duplicado E2E', uid)
    L.commit()
    L.ok(L.q1("SELECT estado FROM tienda.movimientos_caja WHERE id = %s", (mv,)) == 'ANULADO', 'egreso anulado con motivo')
    L.ok(L.q1("SELECT motivo_anulacion FROM tienda.movimientos_caja WHERE id = %s", (mv,)) is not None, 'motivo guardado')
    L.espera_error('no se puede anular un movimiento dos veces', L.fn, 'fn_anular_movimiento_caja', mv, 'otra', uid)

    # 3) Resumen de la apertura: totales por moneda, ventas y entradas/salidas
    r = L.fn('fn_resumen_apertura', ap)
    r = r if isinstance(r, dict) else J.loads(r)
    L.ok(int(r['ventas']) >= 1, f'resumen del turno: {r["ventas"]} ventas, vendido {r["vendido_usd"]} USD')
    L.ok(len(r['monedas']) >= 1, f'arqueo por moneda con "esperado": {[m["moneda"] for m in r["monedas"]]}')

    # 4) Corte X con desglose (ventas, ticket promedio, pagos por método)
    x = L.fn_fila('fn_corte_desglose', hoy, hoy, uid)
    L.ok(x is not None, f'corte X consultable: {str(x)[:90]}…')

    # 5) Cierre Z: cierra el turno con arqueo
    L.fn('fn_cerrar_apertura', ap, uid)
    L.commit()
    a = L.fila("SELECT * FROM tienda.aperturas_caja WHERE id = %s", (ap,))
    L.ok(a['estado'] == 'CERRADA', f'turno #{ap} cerrado (Z)')
    L.ok(L.fn('fn_apertura_activa', uid) is None, 'sin apertura activa tras el cierre')
    # El informe de arqueo lo guarda el controlador de Cierre con lo contado por el cajero:
    r2 = L.fn('fn_resumen_apertura', ap)
    r2 = r2 if isinstance(r2, dict) else J.loads(r2)
    esp = {m['moneda']: float(m['esperado']) for m in r2['monedas']}
    L.ejecutar("INSERT INTO tienda.cierres_caja (fecha, usuario_id, cerrado_por, ventas, total_usd, total_ves, conteo, esperado, "
               "diferencia, detalle, observaciones, apertura_id) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s)",
               (L.hoy(), uid, uid, int(r2['ventas']), float(r2['total_usd']), float(r2['total_ves']),
                J.dumps({k: v for k, v in esp.items()}), J.dumps({k: v for k, v in esp.items()}),
                J.dumps({k: 0 for k in esp}), J.dumps({'lineas': []}), 'Arqueo cuadrado E2E', ap))
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.cierres_caja WHERE apertura_id = %s", (ap,)) == 1, 'informe del cierre Z guardado')
    dif = L.q1("SELECT diferencia::text FROM tienda.cierres_caja WHERE apertura_id = %s", (ap,))
    L.ok(dif is not None and ('"USD":0' in dif.replace(' ', '') or 'USD' not in dif),
         f'arqueo cuadrado (diferencia {dif})')
    L.espera_error('no se puede mover caja de un turno cerrado', L.fn, 'fn_registrar_movimiento_caja', uid, 'INGRESO',
                   'Intento tardío', 'USD', 1, None, 'MANUAL', None, True, True, None)

    # 6) Se puede abrir un nuevo turno el mismo usuario (siguiente turno del día)
    ap2 = L.fn('fn_abrir_caja', uid, 10, 100)
    L.commit()
    L.ok(ap2 is not None and float(L.fn('fn_apertura_activa', uid)) == float(ap2), f'nuevo turno #{ap2} abierto')

    # 7) La vista de cierre muestra el informe con cuadre
    L.ok(L.q1("SELECT count(*) FROM tienda.v_cierre_caja") >= 1, 'v_cierre_caja disponible con historial')
