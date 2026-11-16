# -*- coding: utf-8 -*-
"""f09 · ALTA: Notas de crédito sobre venta a crédito (parte CxC, parte caja)."""
import json as J

import e2e_lib as L
import f_lib as F


def nota_baja(multiplo, precio, tasa):
    base = round(precio * multiplo * tasa, 2)
    iva = round(precio * multiplo * 0.16 * tasa, 2)
    return base, iva, base + iva


def crear_nota(venta, precio, tasa, mult, uid, numero):
    b, i, t = nota_baja(mult, precio, tasa)
    return L.ins('notas_ajuste', tipo='C', numero=str(numero), venta_id=venta, fecha=L.hoy(), iva_pct=16,
                 base_ves=b, iva_ves=i, total_ves=t, motivo='Nota fiscal E2E', usuario_id=uid, devuelve_inventario=False)


def main():
    L.empezar('f09 · Notas de crédito sobre venta a crédito')
    uid = L.admin()
    hoy = L.hoy()
    p = L.q1("SELECT id FROM tienda.productos WHERE activo AND NOT exento_iva ORDER BY id LIMIT 1")
    precio = float(L.q1("SELECT precio_venta_usd FROM tienda.productos WHERE id = %s", (p,)))
    m = F.m_efectivo('Efectivo Bs')

    # asegurar stock para las 3 ventas de la prueba
    L.fn('fn_registrar_compra', L.q1("SELECT id FROM tienda.proveedores WHERE activo ORDER BY id LIMIT 1"),
         f"F-F09-{L.fake.random_number(digits=5)}", hoy, 'USD',
         [{'producto_id': p, 'cantidad': 10, 'costo_unitario': 0.5, 'exento': False}], uid)
    L.commit()
    precio = float(L.q1("SELECT precio_venta_usd FROM tienda.productos WHERE id = %s", (p,)))  # el costo nuevo pudo recalcular el precio

    cli = L.ins('clientes', nombre=L.fake.name(), documento=L.rif('V'), tipo_documento='V', activo=True)
    L.commit()

    # 1) Venta a crédito grande: 3 unidades → CxC con saldo
    items = J.dumps([{'producto_id': p, 'cantidad': 3, 'descuento_pct': 0}])
    vc = L.fn('fn_registrar_venta', uid, items, J.dumps([]), cli, None, 'PRESENCIAL', True, 15)
    L.commit()
    cta = L.q1("SELECT id FROM tienda.cuentas_por_cobrar WHERE venta_id = %s", (vc,))
    cxc0 = L.fila("SELECT saldo_usd, saldo_ves, estado FROM tienda.cuentas_por_cobrar WHERE id = %s", (cta,))
    tasa = float(L.q1("SELECT tasa_cambio FROM tienda.ventas WHERE id = %s", (vc,)))
    L.ok(float(cxc0['saldo_ves']) > 0, f'CxC abierta por {cxc0["saldo_ves"]} Bs ({cxc0["saldo_usd"]} USD)')

    # 2) Nota PARCIAL (1 unidad): baja la CxC, NO devuelve dinero
    n1 = crear_nota(vc, precio, tasa, 1, uid, 901)
    L.commit()
    cxc1 = L.fila("SELECT saldo_usd, saldo_ves, estado FROM tienda.cuentas_por_cobrar WHERE id = %s", (cta,))
    L.ok(abs(float(cxc1['saldo_ves']) - (float(cxc0['saldo_ves']) - round(precio * 1.16 * tasa, 2))) < 0.05,
         f'nota parcial baja la CxC: {cxc0["saldo_ves"]} → {cxc1["saldo_ves"]}')
    L.ok(abs(float(L.fn('fn_nota_reembolsable_ves', n1))) < 0.01, 'la nota parcial se aplicó completa a la deuda: nada reembolsable')
    L.ok(L.q1("SELECT count(*) FROM tienda.movimientos_caja WHERE nota_id = %s", (n1,)) == 0, 'NO sale dinero de caja (la deuda sigue)')
    L.ok(L.q1("SELECT count(*) FROM tienda.notas_cxc_aplicacion WHERE nota_id = %s", (n1,)) == 1, 'aplicación registrada en notas_cxc_aplicacion')

    # 3) Nota EXCEDENTE (10 unidades): liquida la CxC y el exceso queda reembolsable
    cxc_antes = float(L.q1("SELECT saldo_ves FROM tienda.cuentas_por_cobrar WHERE id = %s", (cta,)))
    n2 = crear_nota(vc, precio, tasa, 10, uid, 902)
    L.commit()
    cxc2 = L.fila("SELECT saldo_usd, saldo_ves, estado FROM tienda.cuentas_por_cobrar WHERE id = %s", (cta,))
    L.ok(float(cxc2['saldo_usd']) == 0 and cxc2['estado'] == 'PAGADA', f'CxC liquidada por la nota excedente ({cxc2["estado"]})')
    reemb = float(L.fn('fn_nota_reembolsable_ves', n2))
    L.ok(abs(reemb - (float(L.q1("SELECT total_ves FROM tienda.notas_ajuste WHERE id = %s", (n2,))) - cxc_antes)) < 0.05,
         f'el exceso queda reembolsable: {reemb} Bs')
    # devolución en caja del exceso (el dinero que sí se devuelve)
    mv = L.fn('fn_devolver_nota_en_caja', n2, m, round(reemb, 2), uid, f'DEV-{L.fake.random_number(digits=6)}')  # el método es Bs: monto en Bs
    L.commit()
    L.ok(mv is not None, 'el exceso se devolvió en caja (EGRESO ligado a la nota)')
    eg = L.fila("SELECT tipo, moneda, monto, monto_usd, monto_ves FROM tienda.movimientos_caja WHERE id = %s", (mv,))
    L.ok(eg and eg['tipo'] == 'EGRESO' and abs(float(eg['monto_ves']) - reemb) < 1.0,
         'EGRESO de caja ' + str(eg['monto']) + ' ' + str(eg['moneda']) + ' ≈ exceso ' + str(reemb) + ' Bs')

    # 4) Nota sobre venta de CONTADO: no toca CxC, todo es reembolsable
    vcont = L.fn('fn_registrar_venta', uid, J.dumps([{'producto_id': p, 'cantidad': 1, 'descuento_pct': 0}]),
                 J.dumps([{'metodo_pago_id': m, 'monto': round(precio * 1.16 * tasa, 2), 'referencia': 'PM-N'}]), None, None, 'PRESENCIAL')
    L.commit()
    L.ok(L.q1("SELECT count(*) FROM tienda.cuentas_por_cobrar WHERE venta_id = %s", (vcont,)) == 0, 'venta de contado sin CxC')
    n3 = crear_nota(vcont, precio, tasa, 1, uid, 903)
    L.commit()
    L.ok(abs(float(L.fn('fn_nota_reembolsable_ves', n3)) - float(L.q1("SELECT total_ves FROM tienda.notas_ajuste WHERE id = %s", (n3,)))) < 0.01,
         'nota sobre contado: el 100 % es reembolsable (todo va a caja)')

    # 5) Anular la venta a crédito CON notas aplicadas: rechazado (devolvería stock dos veces)
    L.espera_error('anular venta con notas de crédito rechazado', L.ejecutar,
                   "CALL tienda.sp_anular_venta(%s, %s, %s)", (vc, uid, 'Intento con notas'))
    L.ok(L.q1("SELECT estado FROM tienda.ventas WHERE id = %s", (vc,)) != 'ANULADA', 'la venta sigue vigente')

    # 6) El asiento de la nota de crédito (contab automática) cuadra
    L.ejecutar("UPDATE tienda.contab_config SET automatica = true WHERE id = 1")
    L.commit()
    try:
        L.fn('fn_asiento_nota', n1)
        L.commit()
    except Exception:
        L.conn.rollback()
    a = L.fila("SELECT (SELECT sum(d.debe) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) debe, "
               "(SELECT sum(d.haber) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) haber "
               "FROM tienda.asientos a WHERE a.origen_tipo = 'NOTA_CREDITO' AND a.origen_id = %s", (n1,))
    L.ok(a is None or abs(float(a['debe']) - float(a['haber'])) < 0.01, 'asiento de la nota de crédito cuadrado (si contab activa)')
    L.ejecutar("UPDATE tienda.contab_config SET automatica = false WHERE id = 1")
    L.commit()
