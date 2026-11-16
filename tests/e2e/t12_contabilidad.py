# -*- coding: utf-8 -*-
"""t12 · Contabilidad: asientos automáticos de venta y compra, asiento manual cuadrado,
contra-asiento, libros, apertura de balance y cierre/reapertura de período."""
import json

import e2e_lib as L


def main():
    L.empezar('t12 · Contabilidad y libros')
    uid = L.admin()
    hoy = L.hoy()

    # 1) Activar la contabilidad automática (como en Configuración → Contabilidad)
    L.ejecutar("UPDATE tienda.contab_config SET automatica = true WHERE id = 1")
    L.commit()
    L.ok(L.q1("SELECT automatica FROM tienda.contab_config WHERE id = 1") is True, 'contabilidad automática activada')
    n_cuentas = L.q1("SELECT count(*) FROM tienda.plan_cuentas WHERE activa")
    L.ok(n_cuentas >= 30, f'plan de cuentas con {n_cuentas} cuentas activas')

    # 2) Asiento automático de la venta más reciente: cuadrado, con IVA y ventas
    vid = L.q1("SELECT id FROM tienda.ventas WHERE estado <> 'ANULADA' ORDER BY id DESC LIMIT 1")
    L.fn('fn_asiento_venta', vid)
    L.commit()
    a = L.fila("SELECT a.id, a.fecha, (SELECT sum(d.debe) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) AS debe, "
               "(SELECT sum(d.haber) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) AS haber, "
               "(SELECT count(*) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) AS n "
               "FROM tienda.asientos a WHERE a.origen_tipo = 'VENTA' AND a.origen_id = %s", (vid,))
    L.ok(a is not None, f'asiento de la venta #{vid} generado')
    L.ok(a['n'] >= 3, f'asiento con {a["n"]} líneas (caja/bancos, IVA, ventas, costo)')
    L.ok(abs(float(a['debe']) - float(a['haber'])) < 0.01, f'cuadra: debe {a["debe"]} = haber {a["haber"]}')
    v = L.fila("SELECT v.total_cobrar_usd, v.tasa_cambio, COALESCE(sum(d.cantidad * p.costo_usd), 0) AS costo_usd "
               "FROM tienda.ventas v JOIN tienda.detalle_venta d ON d.venta_id = v.id "
               "JOIN tienda.productos p ON p.id = d.producto_id WHERE v.id = %s GROUP BY v.id", (vid,))
    esperado = round((float(v['total_cobrar_usd']) + float(v['costo_usd'])) * float(v['tasa_cambio']), 2)
    L.ok(abs(float(a['debe']) - esperado) < 1.0,
         f'debe en Bs = (cobros + costo vendido) × tasa: {a["debe"]} ≈ {esperado}')

    # 3) Asiento automático de la compra (crédito fiscal)
    cid = L.q1("SELECT id FROM tienda.compras WHERE estado <> 'ANULADA' ORDER BY id DESC LIMIT 1")
    L.fn('fn_asiento_compra', cid)
    L.commit()
    ac = L.fila("SELECT (SELECT sum(d.debe) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) AS debe, "
                "(SELECT sum(d.haber) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) AS haber "
                "FROM tienda.asientos a WHERE a.origen_tipo = 'COMPRA' AND a.origen_id = %s", (cid,))
    L.ok(ac and abs(float(ac['debe']) - float(ac['haber'])) < 0.01, 'asiento de compra cuadrado (inventario + IVA crédito)')

    # 4) Asiento manual: cuadrado pasa, descuadrado se rechaza
    c_deuda = L.q1("SELECT id FROM tienda.plan_cuentas WHERE activa AND permite_movimiento ORDER BY id LIMIT 1")
    c_iva = L.q1("SELECT id FROM tienda.plan_cuentas WHERE activa AND permite_movimiento AND codigo LIKE '2%' ORDER BY id LIMIT 1") or \
        L.q1("SELECT id FROM tienda.plan_cuentas WHERE activa AND permite_movimiento AND id <> %s ORDER BY id LIMIT 1", (c_deuda,))
    L.fn('fn_crear_asiento', hoy, 'Ajuste manual E2E', 'MANUAL', None,
         json.dumps([{'cuenta_id': c_deuda, 'debe': 100, 'haber': 0, 'glosa': 'carga'},
                     {'cuenta_id': c_iva, 'debe': 0, 'haber': 100, 'glosa': 'abono'}]), uid)
    L.commit()
    L.ok(True, 'asiento manual cuadrado registrado')
    L.espera_error('asiento descuadrado rechazado', L.fn, 'fn_crear_asiento', hoy, 'Descuadre E2E', 'MANUAL', None,
                   json.dumps([{'cuenta_id': c_deuda, 'debe': 100, 'haber': 0, 'glosa': 'x'},
                               {'cuenta_id': c_iva, 'debe': 0, 'haber': 90, 'glosa': 'y'}]), uid)

    # 5) Contra-asiento (reversión) de la venta: el nuevo asiento queda cuadrado con los montos invertidos
    L.fn('fn_contra_asiento', 'VENTA', vid, 'ANULACION_VENTA', hoy, 'Reversión E2E', uid)
    L.commit()
    contra = L.fila("SELECT (SELECT sum(d.debe) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) AS debe, "
                    "(SELECT sum(d.haber) FROM tienda.asiento_detalle d WHERE d.asiento_id = a.id) AS haber "
                    "FROM tienda.asientos a WHERE a.origen_tipo = 'ANULACION_VENTA' AND a.concepto LIKE 'Reversión E2E%' "
                    "ORDER BY a.id DESC LIMIT 1")
    L.ok(contra and abs(float(contra['debe']) - float(contra['haber'])) < 0.01, 'contra-asiento creado y cuadrado')

    # 6) Libros: diario, mayor y una cuenta
    nd = L.q1("SELECT count(*) FROM tienda.fn_libro_diario(%s, %s)", (hoy, hoy))
    L.ok(nd >= 1, f'libro diario del día con {nd} líneas')
    may = L.q1("SELECT count(*) FROM tienda.fn_libro_mayor(%s, %s)", (hoy, hoy))
    L.ok(may >= 1, f'libro mayor con {may} líneas')
    cod_cuenta = L.q1("SELECT codigo FROM tienda.plan_cuentas WHERE id = %s", (c_deuda,))
    mc = L.qs("SELECT * FROM tienda.fn_mayor_cuenta(%s, %s, %s)", (cod_cuenta, hoy, hoy))
    L.ok(len(mc) >= 0, f'mayor de la cuenta {cod_cuenta} consultable ({len(mc)} movimientos)')

    # 7) Apertura de balance (activos/pasivos iniciales) que cuadra
    L.fn('fn_crear_apertura', hoy, 500, 1200, 300, 800, 900, 150, 0, uid)
    L.commit()
    L.ok(True, 'apertura de balance registrada')

    # 8) Cierre y reapertura de un período pasado
    periodo = hoy.replace(day=1).replace(month=max(1, hoy.month - 1)) if hoy.month > 1 else hoy
    L.fn('fn_cerrar_periodo', periodo, uid, 'Cierre E2E')
    L.commit()
    L.ok(True, f'período {periodo} cerrado')
    L.espera_error('no se puede asentar en un período cerrado', L.fn, 'fn_crear_asiento', periodo, 'Fuera de tiempo', 'MANUAL', None,
                   json.dumps([{'cuenta_id': c_deuda, 'debe': 1, 'haber': 0, 'glosa': 'x'},
                               {'cuenta_id': c_iva, 'debe': 0, 'haber': 1, 'glosa': 'y'}]), uid)
    L.fn('fn_reabrir_periodo', periodo, uid, 'Necesitamos corregir un asiento')
    L.commit()
    L.ok(True, 'período reabierto')
    L.ok(L.q1("SELECT count(*) FROM tienda.v_utilidad_diaria") >= 0, 'v_utilidad_diaria disponible')
